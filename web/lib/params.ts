import type { Params } from "@capfare/shared";
import example from "./example-params.json";
import { overview } from "./chain";

export async function paramsOrExample(): Promise<{ params: Params; live: boolean }> {
  try {
    const o = await overview();
    return { params: o.params, live: true };
  } catch {
    const { _meta, ...p } = example as unknown as Params & { _meta?: unknown };
    void _meta;
    return { params: p as Params, live: false };
  }
}
