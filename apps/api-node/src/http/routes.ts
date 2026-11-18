import HTTPServer from "./http-server.ts";
import { LexicalGrpcClient } from "../grpc/lexical-client.ts";
import { SemanticGrpcClient } from "../grpc/semantic-client.ts";
import { cleanseQuery, cors, helmet } from "./middlewares.ts";

const serverApp = new HTTPServer();
const lexicalGrpcClient = new LexicalGrpcClient({
    target: "0.0.0.0:50052"
});
const semanticGrpcClient = new SemanticGrpcClient({
    target: "0.0.0.0:50051"
})

serverApp.beforeEach(cors);
serverApp.beforeEach(helmet);

serverApp.get('/autocomplete', cleanseQuery, (req, res) => {
    const q = req.query.get("q") ?? "";

    // get suggestions
    const suggestions: string[] = [];

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(suggestions));
});

serverApp.get('/search', cleanseQuery, async (req, res) => {
    const q = req.query.get("q") ?? "";
    const page = Number(req.query.get("page") ?? "1");

    const lexical = await lexicalGrpcClient.search(q);
    console.log(lexical)
    const semantic = await semanticGrpcClient.search(q);
    console.log(semantic)

    // const [lexical, semantic] = await Promise.all([
    //     lexicalGrpcClient.search(q),
    //     semanticGrpcClient.search(q)
    // ]);

    // console.log(lexical, semantic);

    const results: string[] = [];

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(results));
});

serverApp.post('/summary', (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    res.flushHeaders(); 
});

serverApp.get('/crawling', (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    res.flushHeaders(); 
});

export default serverApp;