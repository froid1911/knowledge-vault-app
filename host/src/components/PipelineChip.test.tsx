// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineStatus } from "../vaults.js";
import { PipelineChip } from "./PipelineChip.js";

const info = { origin: "http://127.0.0.1:4301", graphqlUrl: "http://127.0.0.1:4301/graphql", controlOrigin: "http://127.0.0.1:4302", controlToken: "t" };
afterEach(() => cleanup());

describe("PipelineChip", () => {
  it("shows the state, offers the action, and refreshes after setting the pipeline up", async () => {
    let status: PipelineStatus = { state: "missing" };
    const fetchPipeline = vi.fn(async () => status);
    const setupPipeline = vi.fn(async () => { status = { state: "ready", workflowId: "wf", connectionId: "c", trigger: { status: "ENABLED", lastPollAt: null, lastError: null } }; return status; });
    render(<PipelineChip info={info} vaultId="v1" api={{ fetchPipeline, setupPipeline }} onModels={() => {}} onRuns={() => {}} pollMs={60_000} />);
    expect(await screen.findByText("Processing not set up")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    await waitFor(() => expect(setupPipeline).toHaveBeenCalledWith(info, "v1"));
    expect(await screen.findByText("Processing ready")).toBeTruthy();
  });
  it("polls while mounted and routes the actions: a failed run → runs, no model → models", async () => {
    const onRuns = vi.fn();
    const onModels = vi.fn();
    let n = 0;
    const fetchPipeline = vi.fn(async (): Promise<PipelineStatus> => (++n < 3 ? { state: "unconfigured" } : { state: "ready", workflowId: "wf", connectionId: "c", trigger: { status: "ENABLED", lastPollAt: null, lastError: null }, lastRun: { id: "r", status: "FAILED", startedAt: null, endedAt: null, error: "no model here" } }));
    render(<PipelineChip info={info} vaultId="v1" api={{ fetchPipeline, setupPipeline: vi.fn() }} onModels={onModels} onRuns={onRuns} pollMs={5} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up a model" }));
    expect(onModels).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Last processing run failed")).toBeTruthy());
    expect(screen.getByTitle(/no model here/)).toBeTruthy(); // the run's error is the chip's tooltip
    fireEvent.click(screen.getByRole("button", { name: "See runs" }));
    expect(onRuns).toHaveBeenCalled();
    expect(fetchPipeline.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
