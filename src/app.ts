import { createServer } from "node:http";

const PORT = process.env.PORT || 3000;

const server = createServer((req, res) => {

});

server.listen(PORT, () => {
    console.log(`APP is listening on localhost:${PORT}`)
});