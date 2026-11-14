// import { loadSync } from "@grpc/proto-loader";
// import { loadPackageDefinition, credentials } from "@grpc/grpc-js";

// // Load the same proto file
// const packageDefinition = loadSync('protos/greeter.proto');
// const greeterProto = loadPackageDefinition(packageDefinition).greeter;

// // Create client stub
// const client = new greeterProto.Greeter('localhost:50051', credentials.createInsecure());

// // Make RPC call
// client.sayHello({ name: 'World' }, (err, response) => {
//     if (err) return console.error(err);
//     console.log('Greeting:', response.message);
// });   