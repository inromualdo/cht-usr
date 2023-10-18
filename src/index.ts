import { env } from "node:process";
import server from "./web/server";

let user = env.CHT_USER;
let pass = env.CHT_PASSWORD;
let domain = env.CHT_DOMAIN;

if (!user || !pass || !domain) {
  console.log("need cht credentials");
  process.exit(1);
}
server({ User: user, Pass: pass, Domain: domain });
