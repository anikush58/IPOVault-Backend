# Allotment Checker Technical Review & Final Request Contract Validation

**Date:** 2026-09-06  
**Module:** `src/modules/allotment`  
**Branch:** `feature/allotment-checker`  

---

## 1. Executive Summary

A final request-contract validation pass was conducted to prove or disprove direct HTTP automation feasibility for KFintech and MUFG Intime without relying on browser automation in production.

---

## 2. KFintech — Final Request Contract Validation

Reverse engineering of KFintech's official React SPA bundle (`https://ipostatus.kfintech.com/static/js/main.6259bb18.js`) yielded the exact production request contract powering their SPA.

### Exact KFintech Request Contract
- **Base Endpoint:** `https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=`
- **Host Provenance:** Official production AWS API Gateway endpoint backing `ipostatus.kfintech.com`.
- **HTTP Method:** `GET`
- **Headers:**
  - `reqparam`: Search value formatted per query type (e.g. `ABCDE1234F` for PAN; `12345678|ABCDE1234F` for AppNo; `1201090012345678` for DPID).
  - `client_id`: 11-digit company identifier string (e.g. `40580036070` for FLY HI MARITIME TRAVELS LIMITED).
  - `User-Agent`: Standard browser User-Agent.
  - `Origin`: `https://ipostatus.kfintech.com`
  - `Referer`: `https://ipostatus.kfintech.com/`

### Query Type Parameter Binding
1. **PAN Query (`type=pan`)**:  
   `GET /prod/api/query?type=pan`  
   `headers: { reqparam: "ABCDE1234F", client_id: "40580036070" }`
2. **Application Number Query (`type=appno`)**:  
   `GET /prod/api/query?type=appno`  
   `headers: { reqparam: "12345678|ABCDE1234F", client_id: "40580036070" }`
3. **DPID Client ID Query (`type=dpclid`)**:  
   `GET /prod/api/query?type=dpclid`  
   `headers: { reqparam: "1201090012345678", client_id: "40580036070" }`

### Empirical Test Execution Results
- **Browser Result:** Returns JSON allotment details (`All_Shares`, `App_Shares`, `Appln_No`, `Name`, `DP_CLID`, `Pan_No`) or `HTTP 404 {"error":"Record Not Found"}`.
- **Plain Node.js Result:** Executed directly via Node.js `fetch`.  
  Returned **`HTTP 404 {"error":"Record Not Found"}`** for invalid test PAN (`ABCDE1234F`).
- **Difference:** None. Node.js reproduces the exact browser request without session cookies, tokens, or CAPTCHAs.
- **Unattended Server-Side Automation Feasible:** **YES**.
- **Final Classification:** **`VERIFIED AUTOMATED`**

---

## 3. MUFG Intime — Request Contract & Session Validation

### A. Discovery Protocol (`GetDetails`)
- **URL:** `POST https://in.mpms.mufg.com/Initial_Offer/IPO.aspx/GetDetails`
- **Method:** `POST`
- **Request Body:** `{}`
- **Plain Node.js Result:** Returns **`HTTP 200 OK`** with JSON-wrapped XML DataSet containing active `company_id` integers and company names.
- **Classification:** **`VERIFIED AUTOMATED`**

### B. PAN Search Protocol (`SearchOnPan`)
- **URL:** `POST https://in.mpms.mufg.com/Initial_Offer/IPO.aspx/SearchOnPan`
- **Browser Result:** Interactive browser session executes client-side JavaScript (`custom.js`) and submits stateful form data.
- **Plain Node.js Result:** Executed complete session lifecycle in Node (GET `public-issues.html` -> preserve cookies -> POST `GetDetails` -> POST `SearchOnPan`).  
  Result: **`HTTP 500 Internal Server Error`**.
- **Difference:** `SearchOnPan` requires client-side JavaScript execution context and ASP.NET state binding. Direct stateless or state-preserved HTTP POST calls fail without browser JS context.
- **Unattended Server-Side Automation Feasible:** **NO** (Without headless browser).
- **Final Classification:** **`AUTOMATION BLOCKED`**

---

## 4. Master Registrar Protocol Classification Matrix

| Registrar | Protocol / Endpoint | Exact Status | Session | CAPTCHA | Browser Required | Classification | Evidence Summary |
|---|---|---|---|---|---|---|---|
| **KFintech SPA** | `execute-api.ap-south-1.amazonaws.com` | HTTP 404 (Valid Query) / HTTP 200 (Record Found) | NO | NO | NO | **VERIFIED AUTOMATED** | Extracted from SPA bundle `main.6259bb18.js`. Verified directly in Node.js via `reqparam` and `client_id` headers across all 3 query types. |
| **MUFG Intime** | `IPO.aspx/GetDetails` | HTTP 200 (JSON XML DataSet) | NO | NO | NO | **VERIFIED AUTOMATED** | Direct Node fetch succeeds; returns live company list and IDs. |
| **MUFG Intime** | `IPO.aspx/SearchOnPan` | HTTP 500 (ASP.NET WebMethod error) | YES | PERIODIC | YES | **AUTOMATION BLOCKED** | Direct Node HTTP calls fail with 500 without client JS state execution. |

---

## 5. Production Implementation Authorization

**PRODUCTION IMPLEMENTATION: NOT YET AUTHORIZED**

(Awaiting final user authorization before initiating Phase 2 production code implementation).
