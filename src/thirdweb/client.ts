import { createThirdwebClient } from "thirdweb";

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

export const thirdwebClient = createThirdwebClient({
  clientId: mustEnv("VITE_THIRDWEB_CLIENT_ID"),
});