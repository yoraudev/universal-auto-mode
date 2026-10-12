import { createClient } from "../shared/client.js"
import { createExtension } from "./extension.js"

export default createExtension(createClient({ port: process.env.UAM_PORT ? Number(process.env.UAM_PORT) : undefined }))
