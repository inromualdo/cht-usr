import Fastify from "fastify";
import view from "@fastify/view";
import formbody from "@fastify/formbody";
import { Credentials, getAppSettings, searchPlace } from "../lib/cht";
import { getHierarchy, getRoles } from "../data/app_settings";
import { Liquid } from "liquidjs";
import {
  addPlace,
  getPlaces,
  getPlaceTypes,
  getUserRoles,
  initWorkbook,
  initAppState,
  findPlace,
  getParentType,
  getPlace,
  getWorkbooks,
  place,
} from "../data/cache";

const renderEngine = new Liquid({
  extname: ".html",
  root: "src/web/public",
});
const fastify = Fastify({ logger: true });
fastify.register(formbody);
fastify.register(view, {
  engine: {
    liquid: renderEngine,
  },
});

fastify.get("/", async (req, resp) => {
  const workbooks = getWorkbooks();
  return resp.view("src/web/public/index.html", {
    workbooks: workbooks,
  });
});

fastify.get("/ui/workbook/new", async (req, resp) => {
  return resp.view("src/web/public/components/workbook_create.html", {});
});

fastify.post("/workbook/add", async (req, resp) => {
  const data: any = req.body;
  const id = initWorkbook(data.workbook_name);
  return resp.view("src/web/public/index.html", {
    workbooks: getWorkbooks(),
  });
});

fastify.get("/workbook/:id", async (req, resp) => {
  const params: any = req.params;
  const id = params.id;
  const placeType = getPlaceTypes()[0];

  const tmplData = {
    title: id,
    hierarchy: getPlaceTypes(),
    places: getPlaces(id),
    userRoles: getUserRoles(),
    pagePlaceType: placeType,
    hasParent: getParentType(placeType),
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
  return resp.view("src/web/public/components/place_create.html", {
    pagePlaceType: placeType,
    userRoles: getUserRoles(),
    hasParent: getParentType(placeType),
  });
});

fastify.post("/workbook/:id", async (req, resp) => {
  const params: any = req.params;
  const workbookId = params.id;

  const data: any = req.body;
  if (
    getParentType(data.place_type) &&
    (!data.place_parent || !getPlace(data.place_parent))
  ) {
    resp.status(400);
    return;
  }

  const p: place = {
    id: new Date().getMilliseconds().toString(),
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
    const parent = getPlace(data.place_parent);
    p.parent = {
      id: parent.id,
      name: parent.name,
    };
  }

  addPlace(workbookId, p);

  return resp.view("src/web/public/components/content_update.html", {
    pagePlaceType: data.place_type,
    userRoles: getUserRoles,
    hasParent: !!getParentType(data.place_type),
    places: getPlaces(workbookId),
  });
});

fastify.post("/workbook/search/parent", async (req, resp) => {
  const data: any = req.body;
  const placeType = getParentType(data.place_type)!!;
  const searchString = data.place_search;

  const referrer: string = req.headers["referer"]!!; // idk man, this might be bad
  const workbookId = new URL(referrer).pathname.replace("/workbook/", "");
  if (!workbookId) {
    resp.status(400);
    resp.send("invalid referrer " + referrer);
    return;
  }

  const results = await findPlace(workbookId, placeType, searchString);
  if (results.length === 0) {
    results.push({ id: "na", name: "Place Not Found" });
  }
  return resp.view("src/web/public/components/search_results.html", {
    results: results,
  });
});

fastify.post("/workbook/submit", async (req, resp) => {});

fastify.post("/ui/place/set/parent", async (req, resp) => {
  const params: any = req.query;
  const placeId = params.id;
  if (placeId === "na") {
    resp.status(400);
    return;
  }
  const place = getPlace(placeId);
  return resp.view("src/web/public/components/place_parent_hidden.html", {
    place: place,
  });
});

export default async (creds: Credentials) => {
  const settings = await getAppSettings(creds);
  const hierarchy = getHierarchy(settings);
  const roles = getRoles(settings);
  initAppState(creds, hierarchy, roles);
  fastify.listen({ port: 3000 }, (err, address) => {
    if (err) throw err;
    console.log(`server is listening on ${address}`);
  });
};
