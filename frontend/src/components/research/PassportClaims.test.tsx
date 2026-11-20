import {render,screen} from "@testing-library/react";
import {expect,it} from "vitest";
import {passportCapacity,passportWire} from "../../../../tests/fixtures/research-passport-data.mjs";
import {passportWork,passportResult} from "../../../../apps/gateway/src/research-passport.js";
import type {ResearchPassport} from "@/lib/research-passport";
import {PassportClaims} from "./PassportClaims";

function fixture():ResearchPassport {
  const data=passportCapacity();
  return passportResult(passportWork(data.run),data.documents,data.sources,{answer:JSON.stringify(passportWire(data.sources))}).analysis as ResearchPassport;
}
it("shows the declared product,full qualifications,source quotes and unresolved gaps without certifying a status",()=>{
  const analysis=fixture();render(<PassportClaims analysis={analysis} sourcePrefix="result"/>);
  expect(screen.getByRole("region",{name:"Product passport claims"})).toBeVisible();
  expect(screen.getByText(analysis.subject.product_version)).toBeVisible();
  expect(screen.getByText(analysis.claims[11].qualifications[3])).toBeVisible();
  expect(screen.getByText(analysis.gaps[11].description)).toBeVisible();
  expect(screen.getByRole("link",{name:"[S48]"})).toHaveAttribute("href","#result-S48");
  expect(screen.getByText(/not a verified current status/)).toBeVisible();
});
it("renders an honest empty result and retains the declared subject and source-scope inspection",()=>{
  const analysis=fixture();analysis.claims=[];analysis.gaps=[];
  render(<PassportClaims analysis={analysis}/>);
  expect(screen.getByText(/No source-anchored claims were returned/)).toBeVisible();
  expect(screen.getByText(/absence of a gap is not proof/)).toBeVisible();
  expect(screen.getByText("Consulted source scope (60)")).toBeVisible();
});
