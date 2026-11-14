import { loadSync } from "@grpc/proto-loader";
import { loadPackageDefinition, Server, ServerCredentials, type ServerUnaryCall } from "@grpc/grpc-js";

const host = '0.0.0.0:50051';

// 1. Load the proto file
const packageDefinition = loadSync('protos/greeter.proto');
const greeterProto = loadPackageDefinition(packageDefinition).greeter;

// 2. Define service methods
function sayHello(call: ServerUnaryCall<any, any>, callback: Function) {
    callback(null, { message: `Hello, ${call.request.name}!` });
}

// 3. Create and start the server
const server = new Server();
server.addService(greeterProto, { sayHello });
server.bindAsync(host, ServerCredentials.createInsecure(), (err, port) => {
    if (err) throw err;
    console.log(`listening on ${port}`);
});