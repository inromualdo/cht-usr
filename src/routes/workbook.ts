import { FastifyInstance } from "fastify";
import { uploadState } from "../services/models";

export default async function workbook(fastify: FastifyInstance) {
  const { cache, jobManager } = fastify;

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

    const failed = cache.getPlaceByUploadState(id, uploadState.FAILURE);
    const noStateJobs = cache.getPlaceByUploadState(id, undefined);
    const hasFailedJobs = failed.length > 0;

    const tmplData = {
      title: id,
      workbookId: id,
      hierarchy: cache.getPlaceTypes(),
      places: cache.getPlacesForDisplay(id),
      workbookState: cache.getWorkbookState(id)?.state,
      hasFailedJobs: hasFailedJobs,
      failedJobCount: failed.length,
      noStateJobCount: noStateJobs.length,
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
      const header = await fastify.view(
        "src/public/workbook/view_header.html",
        tmplData
      );
      return content + header;
    }

    return resp.view("src/public/workbook/view.html", tmplData);
  });

  // initiates place creation via the job manager
  fastify.post("/workbook/:id/submit", async (req, resp) => {
    const params: any = req.params;
    const workbookId = params.id!!;
    jobManager.doUpload(workbookId);
    return `<button class="button is-dark" hx-post="/workbook/${workbookId}/submit" hx-target="this" hx-swap="outerHTML">Apply Changes</button>`;
  });
}
