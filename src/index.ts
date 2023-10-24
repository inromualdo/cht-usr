import { env } from "node:process";
import { MemCache } from "./data/cache";
import { UploadManager } from "./data/job";
import { ChtApi } from "./lib/cht";
import { getHierarchy, getRoles } from "./lib/utils";
import server from "./web/server";

let user = env.CHT_USER;
let pass = env.CHT_PASSWORD;
let domain = env.CHT_DOMAIN;

if (!user || !pass || !domain) {
  console.log("need cht credentials");
  process.exit(1);
}

(async () => {
  const chtApi: ChtApi = new ChtApi({ User: user, Pass: pass, Domain: domain });
  const settings = await chtApi.getAppSettings();

  const hierarchy = getHierarchy(settings);
  const roles = getRoles(settings);

  const cache: MemCache = new MemCache(chtApi, hierarchy, roles);
  const uploadManager: UploadManager = new UploadManager(chtApi, cache);

  server(cache, uploadManager);
})();
