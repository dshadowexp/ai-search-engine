import server from "./http/main.ts";

server.listen(3030, () => {
    console.log("server is listening on localhost:3030")
})