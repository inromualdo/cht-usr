import { once } from "events";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parse } from "csv";
import { place } from "../services/models";
import { validatePlace } from "../services/utils";

export default async function workbook(fastify: FastifyInstance) {
  const { cache } = fastify;

  fastify.get("/", async (req, resp) => {
    const workbooks = cache.getWorkbooks();
    return resp.view("src/public/index.html", {
      workbooks: workbooks,
    });
  });

  fastify.get("/workbook/new", async (req, resp) => {
    return resp.view("src/public/workbook/create_form.html", {});
  });

  fastify.post("/workbook", async (req, resp) => {
    const data: any = req.body;
    cache.saveWorkbook(data.workbook_name);
    return resp.view("src/public/index.html", {
      workbooks: cache.getWorkbooks(),
    });
  });

  fastify.get("/workbook/:id", async (req, resp) => {
    const params: any = req.params;
    const id = params.id;
    const placeTypes = cache.getPlaceTypes();

    const queryParams: any = req.query;
    const placeType = queryParams.type || placeTypes[0];
    const op = queryParams.op || "new";

    const tmplData = {
      title: id,
      hierarchy: cache.getPlaceTypes(),
      places: cache.getPlaces(id),
      userRoles: cache.getUserRoles(),
      pagePlaceType: placeType,
      op: op,
      hasParent: cache.getParentType(placeType),
    };

    const isHxReq = req.headers["hx-request"];
    if (isHxReq) {
      const content = await fastify.view(
        "src/public/workbook/content.html",
        tmplData
      );
      return content;
    }

    return resp.view("src/public/workbook/view.html", tmplData);
  });

  fastify.post("/workbook/:id", async (req, resp) => {
    const queryParams: any = req.query;
    if (queryParams?.bulk === "1") {
      return handleBulkCreatePlaces(req, resp);
    } else {
      return handleCreatePlace(req, resp);
    }
  });

  const handleBulkCreatePlaces = async (
    req: FastifyRequest,
    resp: FastifyReply
  ): Promise<any> => {
    const params: any = req.params;
    const workbookId = params.id;

    const fileData: any = await req.file();
    const csvBuf = await fileData.toBuffer();
    const parser = parse(csvBuf, { delimiter: ",", from_line: 1 });

    let parent: any;
    if (fileData.fields["place_parent"]) {
      const result = cache.getCachedResult(
        fileData.fields["place_parent"].value
      )!!;
      parent = {
        id: result.id,
        name: result.name,
      };
    }
    const placeType = fileData.fields["place_type"].value;
    const userRole = fileData.fields["contact_role"].value;

    let columns: string[];
    parser.on("data", function (row: string[]) {
      if (!columns) {
        columns = row;
      } else {
        const p: place = {
          name: row[columns.indexOf("place")],
          type: placeType,
          contact: {
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

    await once(parser, "finish");

    const form = await fastify.view("src/public/place/bulk_create_form.html", {
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles(),
      hasParent: !!cache.getParentType(placeType),
    });
    const list = await fastify.view("src/public/place/list.html", {
      oob: true,
      places: cache.getPlaces(workbookId),
    });

    return form + list;
  };

  const handleCreatePlace = async (
    req: FastifyRequest,
    resp: FastifyReply
  ): Promise<any> => {
    const params: any = req.params;
    const workbookId = params.id;

    const data: any = req.body;
    if (
      cache.getParentType(data.place_type) &&
      (!data.place_parent || !cache.getCachedResult(data.place_parent))
    ) {
      resp.status(400);
      return;
    }

    const results = validatePlace(data);
    if (!results.dataValid) {
      return resp.view("src/public/place/create_form.html", {
        pagePlaceType: data.place_type,
        userRoles: cache.getUserRoles(),
        hasParent: cache.getParentType(data.place_type),
        data: data,
        errors: results.errors,
      });
    }

    const p: place = {
      name: data.place_name,
      type: data.place_type,
      contact: {
        name: data.contact_name,
        phone: data.contact_phone,
        sex: data.contact_sex,
        role: data.contact_role,
      },
    };
    if (data.place_parent) {
      const parent = cache.getCachedResult(data.place_parent)!!;
      p.parent = {
        id: parent.id,
        name: parent.name,
      };
    }

    cache.savePlace(workbookId, p);

    const form = await fastify.view("src/public/place/create_form.html", {
      pagePlaceType: data.place_type,
      userRoles: cache.getUserRoles(),
      hasParent: !!cache.getParentType(data.place_type),
    });
    const list = await fastify.view("src/public/place/list.html", {
      oob: true,
      places: cache.getPlaces(workbookId),
    });

    return form + list;
  };
}
