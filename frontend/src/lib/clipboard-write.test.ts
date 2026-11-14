import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {clipboardConfirmationMs,clipboardFailureMessage,writeClipboardText} from "./clipboard-write";

const writeText=vi.fn();
beforeEach(()=>{
  vi.useFakeTimers();writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});

it("calls the browser synchronously and clears its confirmation timer on success",async()=>{
  const writing=writeClipboardText("Original synthetic text");
  expect(writeText).toHaveBeenCalledExactlyOnceWith("Original synthetic text");
  await writing;expect(vi.getTimerCount()).toBe(0);
});
it("keeps ordinary rejection separate from ambiguous confirmation",async()=>{
  writeText.mockRejectedValueOnce(new Error("Synthetic browser denial"));
  const error=await writeClipboardText("Original").catch(error=>error);
  expect(clipboardFailureMessage(error)).toBe("The clipboard was unavailable.");
  expect(vi.getTimerCount()).toBe(0);
});
it("reports a missing or synchronously throwing API without leaving a timer",async()=>{
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:undefined});
  const missing=await writeClipboardText("Original").catch(error=>error);
  expect(clipboardFailureMessage(missing)).toBe("The clipboard was unavailable.");
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:()=>{throw new Error("Synchronous failure");}}});
  const failure=await writeClipboardText("Original").catch(error=>error);
  expect(clipboardFailureMessage(failure)).toBe("The clipboard was unavailable.");
  expect(vi.getTimerCount()).toBe(0);
});
for(const outcome of ["resolve","reject"] as const)it(`does not retry or accept a late ${outcome} after the confirmation deadline`,async()=>{
  let finish!:()=>void,fail!:(error:Error)=>void;
  writeText.mockReturnValueOnce(new Promise<void>((resolve,reject)=>{finish=resolve;fail=reject;}));
  const settled=vi.fn();const writing=writeClipboardText("Original").then(()=>settled("confirmed"),error=>{settled("unconfirmed");return error;});
  await vi.advanceTimersByTimeAsync(clipboardConfirmationMs-1);expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);const error=await writing;
  expect(clipboardFailureMessage(error)).toContain("Copy was not confirmed");
  expect(clipboardFailureMessage(error)).toContain("may finish later");
  expect(settled).toHaveBeenCalledExactlyOnceWith("unconfirmed");expect(writeText).toHaveBeenCalledTimes(1);
  if(outcome==="resolve")finish();else fail(new Error("Late browser rejection"));
  await Promise.resolve();await Promise.resolve();
  expect(settled).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
