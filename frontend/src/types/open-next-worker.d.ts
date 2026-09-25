declare module "*.open-next/worker.js" {
  const worker: {
    fetch(
      request: Request,
      env: unknown,
      context: unknown
    ): Promise<Response>;
  };

  export default worker;
}