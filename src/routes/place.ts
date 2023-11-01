import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isValidPhoneNumber } from "libphonenumber-js";
import { jobState } from "../services/job";
import { uploadState, workBookState, place } from "../services/models";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv";
import { once } from "events";
import { MultipartFile, MultipartValue } from "@fastify/multipart";

export default async function place(fastify: FastifyInstance) {
  const { cache, cht, jobManager } = fastify;

  // search for a place given its type and name
  // return search results dropdown
  fastify.post("/search/replace", async (req, resp) => {
    const queryParams: any = req.query;
    const placeType = queryParams.type!!;
    const workbookId = queryParams.workbook;

    const data: any = req.body;
    const searchString = data.place_search;

    const results = await cht.searchPlace(placeType, searchString);
    cache.cacheRemoteSearchResult(results);
    if (results.length === 0) {
      results.push({ id: "na", name: "Place Not Found" });
    }
    return resp.view("src/public/components/replace_user_search_results.html", {
      workbookId: workbookId,
      results: results,
    });
  });

  // search for a place's possible parents given its type
  // return search results dropdown
  fastify.post("/search/parent", async (req, resp) => {
    const queryParams: any = req.query;
    const placeType = cache.getParentType(queryParams.type)!!;
    const workbookId = queryParams.workbook;

    const data: any = req.body;
    const searchString = data.place_search;

    const localResults = await cache.findPlace(
      workbookId,
      placeType,
      searchString
    );
    const remoteResults = await cht.searchPlace(placeType, searchString);
    cache.cacheRemoteSearchResult(remoteResults);

    const results = localResults.concat(remoteResults);
    if (results.length === 0) {
      results.push({ id: "na", name: "Place Not Found" });
    }
    return resp.view("src/public/components/search_results.html", {
      workbookId: workbookId,
      pagePlaceType: data.place_type,
      results: results,
    });
  });

  // re-render the whole form with a hidden input that has the place id/name
  // when we select a place from search results
  // for the new place's parent
  fastify.post("/place/parent", async (req, resp) => {
    const data: any = req.body;
    const params: any = req.query;
    const placeId = params.id;
    const workbookId = params.workbook;
    const location: URL = new URL(req.headers.referer!!);
    if (placeId === "na" || !location.searchParams.has("op")) {
      resp.status(400);
      return;
    }
    const place = cache.getCachedSearchResult(placeId, workbookId);
    data.place_parent = place!!.id;
    data.place_search = place!!.name;
    return resp.view("src/public/workbook/content_form.html", {
      workbookId: workbookId,
      op: location.searchParams.get("op"),
      data: data,
      pagePlaceType: data.place_type!!,
      userRoles: cache.getUserRoles(),
      hasParent: cache.getParentType(data.place_type!!),
    });
  });

  // re-render the whole form with a hidden input that has the place id/name
  // when we select a place from search results
  // for user replacements
  fastify.post("/place/replace", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook;
    const placeId = queryParams.id;

    const data: any = req.body;

    const location = new URL(req.headers.referer!!);
    if (placeId === "na" || !location.searchParams.has("op")) {
      resp.status(400);
      return;
    }
    const place = cache.getCachedSearchResult(placeId, workbookId);
    data.place_id = place!!.id;
    data.place_search = place!!.name;
    return resp.view("src/public/workbook/content_form.html", {
      workbookId: workbookId,
      op: location.searchParams.get("op"),
      data: data,
      userRoles: cache.getUserRoles(),
      pagePlaceType: data.place_type!!,
    });
  });

  // you want to create a place? replace a contact? you'll have to go through me first
  fastify.post("/place", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    const op = queryParams.op!!;
    if (op === "new") {
      return createPlace(workbookId, req.body, resp);
    } else if (op === "bulk") {
      // read the date we uploaded
      const fileData = await req.file();
      return createPlaces(workbookId, queryParams.type, fileData!!, resp);
    } else if (op === "replace") {
      return replaceContact(workbookId, req.body, resp);
    }
  });

  // handles the "new" place form, expects to create only one place
  const createPlace = async (
    workbookId: string,
    data: any,
    resp: FastifyReply
  ): Promise<any> => {
    // validate fields here
    const isMissingParent =
      cache.getParentType(data.place_type) && !data.place_parent;
    const isPhoneValid = isValidPhoneNumber(data.contact_phone, "KE");
    if (!isPhoneValid || isMissingParent) {
      return resp.view("src/public/place/create_form.html", {
        workbookId: workbookId,
        pagePlaceType: data.place_type,
        userRoles: cache.getUserRoles(),
        hasParent: cache.getParentType(data.place_type),
        data: data,
        errors: {
          phoneInvalid: !isPhoneValid,
          missingParent: isMissingParent,
        },
      });
    }
    // build the place object, and save it.
    const id = uuidv4();
    const p: place = {
      id: "place::" + id,
      name: data.place_name,
      type: data.place_type,
      action: "create",
      contact: {
        id: "person::" + id,
        name: data.contact_name,
        phone: data.contact_phone,
        sex: data.contact_sex,
        role: data.contact_role,
      },
    };
    if (data.place_parent) {
      const parent = cache.getCachedSearchResult(
        data.place_parent,
        workbookId
      )!!;
      p.parent = {
        id: parent.id,
        name: parent.name,
      };
    }
    // save the place
    cache.savePlace(workbookId, p);
    // finally render an empty form, and the updated place list
    const form = await fastify.view("src/public/place/create_form.html", {
      workbookId: workbookId,
      pagePlaceType: data.place_type,
      userRoles: cache.getUserRoles(),
      hasParent: !!cache.getParentType(data.place_type),
    });
    const list = await fastify.view("src/public/place/list.html", {
      oob: true,
      places: cache.getPlaces(workbookId),
    });
    const controls = await fastify.view("src/public/place/controls.html", {
      oob: true,
      workbookId: workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      noStateJobCount: cache.getPlaceByUploadState(workbookId, undefined)
        .length,
    });
    return form + list + controls;
  };

  // handle bulk place load
  const createPlaces = async (
    workbookId: string,
    placeType: string,
    fileData: MultipartFile,
    resp: FastifyReply
  ): Promise<any> => {
    // read the csv we uploaded
    const csvBuf = await fileData.toBuffer();
    const parser = parse(csvBuf, { delimiter: ",", from_line: 1 });
    const userRole = (fileData.fields["contact_role"] as MultipartValue<string>)
      .value;
    // validate fields here
    const isMissingParent =
      cache.getParentType(placeType) && !fileData.fields["place_parent"];
    if (isMissingParent) {
      return resp.view("src/public/place/bulk_create_form.html", {
        workbookId: workbookId,
        pagePlaceType: placeType,
        userRoles: cache.getUserRoles(),
        hasParent: cache.getParentType(placeType),
        data: {
          contact_role: userRole,
        },
        errors: {
          missingParent: isMissingParent,
        },
      });
    }

    let parent: any;
    if (fileData.fields["place_parent"]) {
      const result = cache.getCachedSearchResult(
        (fileData.fields["place_parent"] as MultipartValue<string>).value,
        workbookId
      )!!;
      parent = {
        id: result.id,
        name: result.name,
      };
    }

    let columns: string[];
    parser.on("data", function (row: string[]) {
      if (!columns) {
        columns = row;
      } else {
        const id = uuidv4();
        const p: place = {
          id: "place::" + id,
          name: row[columns.indexOf("place")],
          type: placeType,
          action: "create",
          contact: {
            id: "person::" + id,
            name: row[columns.indexOf("contact")],
            phone: row[columns.indexOf("phone")],
            sex: row[columns.indexOf("sex")],
            role: userRole,
          },
        };
        if (parent) {
          p.parent = parent;
        }
        cache.savePlace(workbookId, p);
      }
    });
    // wait
    await once(parser, "finish");
    // render an empty form and update the place list
    const form = await fastify.view("src/public/place/bulk_create_form.html", {
      workbookId: workbookId,
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles(),
      hasParent: !!cache.getParentType(placeType),
    });
    const list = await fastify.view("src/public/place/list.html", {
      oob: true,
      places: cache.getPlaces(workbookId),
    });
    const controls = await fastify.view("src/public/place/controls.html", {
      oob: true,
      workbookId: workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      noStateJobCount: cache.getPlaceByUploadState(workbookId, undefined)
        .length,
    });
    return form + list + controls;
  };

  const replaceContact = async (
    workbookId: string,
    data: any,
    resp: FastifyReply
  ) => {
    // kind of like a layout "event" trigger where we just return the form with the data
    if (data.layout) {
      return resp.view("src/public/place/replace_user_form.html", {
        workbookId: workbookId,
        pagePlaceType: data.place_type!!,
        userRoles: cache.getUserRoles(),
        data: data,
      });
    }
    // validate the inputs here
    const isPhoneValid = isValidPhoneNumber(data.contact_phone, "KE");
    if (!isPhoneValid || !data.place_id) {
      if (!data.place_id) data.place_search = "";
      return resp.view("src/public/place/replace_user_form.html", {
        workbookId: workbookId,
        pagePlaceType: data.place_type!!,
        userRoles: cache.getUserRoles(),
        data: data,
        errors: {
          phoneInvalid: !isPhoneValid,
          missingPlace: !data.place_id,
        },
      });
    }
    // create a place for saving
    const id = uuidv4();
    const p: place = {
      id: data.place_id,
      name: data.place_search,
      type: data.place_type,
      action: "replace_contact",
      contact: {
        id: "person::" + id,
        name: data.contact_name,
        phone: data.contact_phone,
        sex: data.contact_sex,
        role: data.contact_role,
      },
    };
    // save the place
    cache.savePlace(workbookId, p);
    // finally render an empty form, and the updated place list
    const form = await fastify.view("src/public/place/replace_user_form.html", {
      workbookId: workbookId,
      pagePlaceType: data.place_type,
      userRoles: cache.getUserRoles(),
    });
    const list = await fastify.view("src/public/place/list.html", {
      oob: true,
      places: cache.getPlaces(workbookId),
    });
    const controls = await fastify.view("src/public/place/controls.html", {
      oob: true,
      workbookId: workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      noStateJobCount: cache.getPlaceByUploadState(workbookId, undefined)
        .length,
    });
    return form + list + controls;
  };

  fastify.post("/place/form/update", async (req, resp) => {
    const queryParams: any = req.query;
    const data: any = req.body;
    const placeType = data.type;
    const op = data.op || "new";
    resp.header("HX-Replace-Url", `?type=${placeType}&op=${op}`);
    return resp.view("src/public/workbook/content_form.html", {
      workbookId: queryParams.workbook,
      op: op,
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles(),
      hasParent: cache.getParentType(placeType),
    });
  });

  fastify.get("/places", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    return resp.view("src/public/place/list.html", {
      places: cache.getPlaces(workbookId),
    });
  });

  fastify.get("/places/controls", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    const failed = cache.getPlaceByUploadState(workbookId, uploadState.FAILURE);
    const noStateJobs = cache.getPlaceByUploadState(workbookId, undefined);
    const hasFailedJobs = failed.length > 0;
    return resp.view("src/public/place/controls.html", {
      workbookId: workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      hasFailedJobs: hasFailedJobs,
      failedJobCount: failed.length,
      noStateJobCount: noStateJobs.length,
    });
  });

  fastify.get("/place/job/status", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    resp.hijack();
    const jobListener = (arg: jobState) => {
      if (arg.workbookId === workbookId)
        resp.sse({ event: "state_change", data: arg.placeId });
    };
    jobManager.on("state", jobListener);
    const workbookStateListener = (arg: workBookState) => {
      if (arg.id === workbookId)
        resp.sse({ event: "workbook_state_change", data: arg.id });
    };
    jobManager.on("workbook_state", workbookStateListener);
    req.socket.on("close", () => {
      jobManager.removeListener("state", jobListener);
      jobManager.removeListener("workbook_state", workbookStateListener);
    });
  });
}
