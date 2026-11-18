import { Contract as ContractObject, Directory as DirectoryObject } from './index.ts'
import { maintenanceRequest } from './operations.ts'
import type { Env } from './http.ts'

function maintenanceEnv(env: Env): Env {
  return { ...env, OPS_KEY: env.INTERNAL_AUTH_KEY }
}

export class Contract extends ContractObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, maintenanceEnv(env))
  }
}

export class Directory extends DirectoryObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, maintenanceEnv(env))
  }
}

export default {
  fetch(request, env) {
    return maintenanceRequest(request, maintenanceEnv(env), true)
  },
} satisfies ExportedHandler<Env>
