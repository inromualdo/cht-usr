import { FastifyInstance } from "fastify";
import { jobState } from "../services/job";
import { workBookState } from "../services/models";

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
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    return resp.view("src/public/place/list.html", {
      places: cache.getPlaces(workbookId),
    });
  });

  fastify.get("/places/controls", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    const failed = cache.getFailed(workbookId);
    const hasFailedJobs = failed.length > 0;
    return resp.view("src/public/place/controls.html", {
      workbookId: workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      hasFailedJobs: hasFailedJobs,
      failedJobCount: failed.length,
    });
  });

  fastify.post("/places", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    jobManager.doUpload(workbookId);
    return '<button class="button is-dark" hx-post="/places" hx-target="this" hx-swap="outerHTML">Create</button>';
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
