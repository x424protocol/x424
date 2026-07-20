/** Maintained Express verifier and resource-server surfaces. */

export * from "./api/router.js";
export * from "./auth/issuance.js";
export {
  assertProtectOptions,
  createExpressHumanDependencyMiddleware,
  type BindingExtractor,
  type BodyInputExtractor,
  type ProtectOptions,
} from "./middleware/resource.js";
