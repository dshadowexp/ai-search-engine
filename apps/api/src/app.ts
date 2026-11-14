import { env } from "process";
import serverApp from "./http/routes.ts";
import { Logger } from "./infrastructure/logger.ts";

const port = parseInt(env.PORT || '3000') || 3000;
const host = env.HOST || `127:0:0:0`;

serverApp.listen(port, () => {
    Logger.getInstance().log(`Server is listening on ${host}:${port}`)
})