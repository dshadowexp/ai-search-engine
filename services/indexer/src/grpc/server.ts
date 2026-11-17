import { 
    Server, 
    ServerCredentials, 
    type ServiceDefinition, 
    type UntypedServiceImplementation 
} from "@grpc/grpc-js";

export class GrpcServer {
    private readonly server: Server;

    constructor() {
        this.server = new Server();
    }

    async start(port: number): Promise<Server> {

        try {
            await new Promise<void>((resolve, reject) => {
                this.server.bindAsync(
                    `0.0.0.0:${port}`,
                    ServerCredentials.createInsecure(),
                    (error) => error ? reject(error) : resolve(),
                );
            });
            
            return this.server;
        } catch (error) {
            this.server.forceShutdown();
            throw error;
        }
    }

    addService(definition: ServiceDefinition, impl: UntypedServiceImplementation) {
        this.server.addService(definition, impl);
    }

    async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.tryShutdown((error) => error ? reject(error) : resolve());
        });
    }
}

