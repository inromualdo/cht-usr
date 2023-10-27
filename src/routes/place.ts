import { FastifyInstance } from "fastify";
import { stringify } from "csv-stringify/sync";
import { jobState } from "../services/job";

export default async function place(fastify: FastifyInstance) {
  const { cache, cht, jobManager } = fastify;

  fastify.post("/search/parent", async (req, resp) => {
    const data: any = req.body;
    const placeType = cache.getParentType(data.place_type)!!;
    const searchString = data.place_search;

    const referrer: string = req.headers["referer"]!!; // idk man, this might be bad
    const workbookId = new URL(referrer).pathname.replace("/workbook/", "");
    if (!workbookId) {
      resp.status(400);
      resp.send("invalid referrer " + referrer);
      return;
    }

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
      results: results,
    });
  });

  fastify.post("/place/parent", async (req, resp) => {
    const params: any = req.query;
    const placeId = params.id;
    if (placeId === "na") {
      resp.status(400);
      return;
    }
    const place = cache.getCachedResult(placeId);
    return resp.view("src/public/components/place_parent_hidden.html", {
      place: place,
    });
  });

  fastify.post("/place/form/update", async (req, resp) => {
    const data: any = req.body;
    const placeType = data.type;
    const op = data.op || "new";
    resp.header("HX-Replace-Url", `?type=${placeType}&op=${op}`);
    return resp.view("src/public/workbook/content_form.html", {
      op: op,
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles(),
      hasParent: cache.getParentType(placeType),
    });
  });

  fastify.get("/places", async (req, resp) => {
    const referrer: string = req.headers["referer"]!!; // idk man, this might be bad
    const workbookId = new URL(referrer).pathname.replace("/workbook/", "");
    if (!workbookId) {
      resp.status(400);
      resp.send("invalid referrer " + referrer);
      return;
    }
    return resp.view("src/public/place/list.html", {
      places: cache.getPlaces(workbookId),
    });
  });

  fastify.post("/places", async (req, resp) => {
    const referrer: string = req.headers["referer"]!!; // idk man, this might be bad
    const workbookId = new URL(referrer).pathname.replace("/workbook/", "");
    if (!workbookId) {
      resp.status(400);
      resp.send("invalid referrer " + referrer);
      return;
    }
    jobManager.doUpload(workbookId);
    return '<button class="button is-dark" hx-post="/places" hx-target="this" hx-swap="outerHTML">Create</button>';
  });

  fastify.get("/place/job/status", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    resp.hijack();
    const listener = (arg: jobState) => {
      if (arg.workbookId === workbookId)
        resp.sse({ event: "state_change", data: arg.placeId });
    };
    jobManager.on("state", listener);
    req.socket.on("close", () => jobManager.removeListener("state", listener));
  });

  fastify.get("/files/template", async (req, resp) => {
    const columns = ["place", "contact", "sex", "phone"];
    return stringify([columns]);
  });
}
