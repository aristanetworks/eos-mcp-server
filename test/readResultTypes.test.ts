import { expectTypeOf, it } from "vitest";
import type { GetRunningConfigResult } from "../src/configuration/getRunningConfig.js";
import type { EosCommandResult } from "../src/eapi/types.js";
import type { GetFactsResult } from "../src/facts/getFacts.js";
import type { ShowLoggingResult } from "../src/logging/showLogging.js";
import type { ProbeDevicesResult } from "../src/probe/probeDevices.js";
import type { RunShowResult } from "../src/show/runShow.js";

type Entry = RunShowResult["results"][number];

it("requires read payload fields on success and error details on failure", () => {
  expectTypeOf<Extract<Entry, { status: "success" }>["command_results"]>().toEqualTypeOf<EosCommandResult[]>();
  expectTypeOf<Extract<Entry, { status: "success" }>["actual_output_format"]>().toEqualTypeOf<"json" | "text">();
  expectTypeOf<Extract<Entry, { status: "failed" }>["command_results"]>().toEqualTypeOf<undefined>();
  expectTypeOf<Extract<Entry, { status: "failed" }>["error_code"]>().toEqualTypeOf<string>();
  expectTypeOf<Extract<Entry, { status: "failed" }>["message"]>().toEqualTypeOf<string>();
  expectTypeOf<Extract<GetFactsResult["results"][number], { status: "success" }>["facts"]["inventory_hostname"]>().toEqualTypeOf<string>();
  expectTypeOf<Extract<GetRunningConfigResult["results"][number], { status: "success" }>["config_text"]>().toEqualTypeOf<string>();
  expectTypeOf<Extract<ShowLoggingResult["results"][number], { status: "success" }>["log_text"]>().toEqualTypeOf<string>();
  expectTypeOf<Extract<ProbeDevicesResult["results"][number], { status: "success" }>["command_results"]>().toEqualTypeOf<EosCommandResult[] | undefined>();
});
