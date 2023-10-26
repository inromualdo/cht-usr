import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import view from "@fastify/view";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import { Liquid } from "liquidjs";
import { FastifySSEPlugin } from "fastify-sse-v2";
import { MemCache, place } from "../data/cache";
import { UploadManager } from "../data/job";
import { isValidPhoneNumber } from "libphonenumber-js";
import { stringify } from "csv-stringify/sync";
import { parse } from "csv";
import { once } from "events";

let cache: MemCache;
let uploadManager: UploadManager;

export default async (memCache: MemCache, manager: UploadManager) => {
  cache = memCache;
  uploadManager = manager;
  fastify.listen({ port: 3000 }, (err, address) => {
    if (err) throw err;
    console.log(`server is listening on ${address}`);
  });
};

const renderEngine = new Liquid({ extname: ".html", root: "src/web/public" });
const fastify = Fastify({
  logger: {
    transport: {
      target: "pino-pretty",
    },
  },
});
fastify.register(view, {
  engine: {
    liquid: renderEngine,
  },
});
fastify.register(formbody);
fastify.register(multipart);
fastify.register(FastifySSEPlugin);

fastify.get("/", async (req, resp) => {
  const workbooks = cache.getWorkbooks();
  return resp.view("src/web/public/index.html", {
    workbooks: workbooks,
  });
});

fastify.get("/ui/workbook/new", async (req, resp) => {
  return resp.view("src/web/public/components/workbook_create.html", {});
});

fastify.post("/workbook/add", async (req, resp) => {
  const data: any = req.body;
  const id = cache.newWorkbook(data.workbook_name);
  return resp.view("src/web/public/index.html", {
    workbooks: cache.getWorkbooks(),
  });
});

fastify.get("/workbook/:id", async (req, resp) => {
  const params: any = req.params;
  const id = params.id;
  const placeTypes = cache.getPlaceTypes();

  const tmplData = {
    title: id,
    hierarchy: cache.getPlaceTypes(),
    places: cache.getPlaces(id),
    userRoles: cache.getUserRoles(),
    pagePlaceType: placeTypes[0],
    hasParent: cache.getParentType(placeTypes[0]),
  };

  const isHxReq = req.headers["hx-request"];
  if (isHxReq) {
    return resp.view("src/web/public/workflow.html", tmplData);
  }
  return resp.view("src/web/public/workbook.html", tmplData);
});

const validatePlace = (
  data: any
): {
  dataValid: boolean;
  errors: {
    phoneInvalid: boolean;
  };
} => {
  const isPhoneValid = isValidPhoneNumber(data.contact_phone, "KE");
  return {
    dataValid: isPhoneValid,
    errors: {
      phoneInvalid: !isPhoneValid,
    },
  };
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
    return resp.view("src/web/public/components/place_create.html", {
      pagePlaceType: data.place_type,
      userRoles: cache.getUserRoles(),
      hasParent: cache.getParentType(data.place_type),
      data: data,
      errors: results.errors,
    });
  }

  const idSuffix = new Date().getMilliseconds().toString();
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

  cache.addPlace(workbookId, p);

  const form = renderEngine.renderFileSync("components/place_create.html", {
    pagePlaceType: data.place_type,
    userRoles: cache.getUserRoles(),
    hasParent: !!cache.getParentType(data.place_type),
  });

  const content = renderEngine.renderFileSync(
    "components/content_update.html",
    {
      places: cache.getPlaces(workbookId),
    }
  );

  return form + content;
};

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
      cache.addPlace(workbookId, p);
    }
  });
  await once(parser, "finish");

  const form = renderEngine.renderFileSync(
    "components/place_bulk_create.html",
    {
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles(),
      hasParent: !!cache.getParentType(placeType),
    }
  );

  const content = renderEngine.renderFileSync(
    "components/content_update.html",
    {
      places: cache.getPlaces(workbookId),
    }
  );

  return form + content;
};

fastify.post("/workbook/:id", async (req, resp) => {
  const queryParams: any = req.query;
  if (queryParams?.bulk === "1") {
    return handleBulkCreatePlaces(req, resp);
  } else {
    return handleCreatePlace(req, resp);
  }
});

fastify.post("/workbook/search/parent", async (req, resp) => {
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

  const results = await cache.findPlace(workbookId, placeType, searchString);
  if (results.length === 0) {
    results.push({ id: "na", name: "Place Not Found" });
  }
  return resp.view("src/web/public/components/search_results.html", {
    results: results,
  });
});

fastify.post("/workbook/submit", async (req, resp) => {
  const referrer: string = req.headers["referer"]!!; // idk man, this might be bad
  const workbookId = new URL(referrer).pathname.replace("/workbook/", "");
  if (!workbookId) {
    resp.status(400);
    resp.send("invalid referrer " + referrer);
    return;
  }
  uploadManager.doUpload(workbookId);
  return '<button class="button is-dark" hx-post="/workbook/submit" hx-target="this" hx-swap="outerHTML">Create</button>';
});

fastify.get("/jobs/status", async (req, resp) => {
  resp.hijack();
  const cb = (id: string) => {
    resp.sse({ event: "status_change", data: "Some message" });
  };
  uploadManager.listen(cb);
  req.socket.on("close", () => uploadManager.removeListener(cb));
});

fastify.get("/ui/workflow/places", async (req, resp) => {
  const referrer: string = req.headers["referer"]!!; // idk man, this might be bad
  const workbookId = new URL(referrer).pathname.replace("/workbook/", "");
  if (!workbookId) {
    resp.status(400);
    resp.send("invalid referrer " + referrer);
    return;
  }
  return resp.view("src/web/public/components/places.html", {
    places: cache.getPlaces(workbookId),
  });
});

fastify.post("/ui/place/update", async (req, resp) => {
  const data: any = req.body;
  const placeType = data.type;
  const op = data.op || "new";
  let form, header;
  if (op === "new") {
    form = renderEngine.renderFileSync("components/place_create.html", {
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles(),
      hasParent: cache.getParentType(placeType),
    });
    header = renderEngine.parseAndRenderSync(
      '<h5 id="form_place_create_header" class="title is-5" hx-swap-oob="true">New {{pagePlaceType}}</h5>',
      {
        pagePlaceType: placeType,
      }
    );
  } else if (op === "bulk") {
    form = renderEngine.renderFileSync("components/place_bulk_create.html", {
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles(),
      hasParent: cache.getParentType(placeType),
    });
    header = renderEngine.parseAndRenderSync(
      '<h5 id="form_place_create_header" class="title is-5" hx-swap-oob="true">Bulk Import {{pagePlaceType}}(s)</h5>',
      {
        pagePlaceType: placeType,
      }
    );
  } else {
    throw new Error("unsupported operation");
  }
  return form + header;
});

fastify.post("/ui/place/set/parent", async (req, resp) => {
  const params: any = req.query;
  const placeId = params.id;
  if (placeId === "na") {
    resp.status(400);
    return;
  }
  const place = cache.getCachedResult(placeId);
  return resp.view("src/web/public/components/place_parent_hidden.html", {
    place: place,
  });
});

fastify.get("/files/template", async (req, resp) => {
  const columns = ["place", "contact", "sex", "phone"];
  return stringify([columns]);
});
