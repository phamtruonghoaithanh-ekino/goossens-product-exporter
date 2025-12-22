import { createRequestHandler } from "@react-router/vercel";

export default createRequestHandler({
  build: () => import("../build/server/index.js"),
});

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};
