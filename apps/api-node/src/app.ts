import { env } from "process";
import serverApp from "./http/routes.ts";
import { LogStream } from "@search/infra";

const port = parseInt(env.PORT || '3000') || 3000;
const host = env.HOST || `127:0:0:0`;

LogStream.getInstance().addStream(process.stdout);

serverApp.listen(port, () => {
    LogStream.getInstance().log(`Server is listening on ${host}:${port}`)
})