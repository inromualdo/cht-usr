import Fastify from "fastify";
import view from "@fastify/view";
import formbody from "@fastify/formbody";
import { Liquid } from "liquidjs";
import { FastifySSEPlugin } from "fastify-sse-v2";
import { MemCache, place } from "../data/cache";
import { UploadManager } from "../data/job";
import { isValidPhoneNumber } from "libphonenumber-js";

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

fastify.post("/workbook/ui/place/update", async (req, resp) => {
  const data: any = req.body;
  const placeType = data.type;
  const form = renderEngine.renderFileSync("components/place_create.html", {
    pagePlaceType: placeType,
    userRoles: cache.getUserRoles(),
    hasParent: cache.getParentType(placeType),
  });
  const header = renderEngine.parseAndRenderSync(
    '<h5 id="form_place_create_header" class="title is-5" hx-swap-oob="true">New {{pagePlaceType}}</h5>',
    {
      pagePlaceType: placeType,
    }
  );
  return form + header;
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

fastify.post("/workbook/:id", async (req, resp) => {
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
    id: "place::" + idSuffix,
    name: data.place_name,
    type: data.place_type,
    contact: {
      id: "person::" + idSuffix,
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

  return resp.view("src/web/public/components/content_update.html", {
    pagePlaceType: data.place_type,
    userRoles: cache.getUserRoles(),
    hasParent: !!cache.getParentType(data.place_type),
    places: cache.getPlaces(workbookId),
  });
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
