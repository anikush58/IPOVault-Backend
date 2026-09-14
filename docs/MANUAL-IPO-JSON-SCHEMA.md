# Manual IPO JSON Import Schema (Single Source of Truth)

This document defines the canonical JSON import specification and contract for importing Initial Public Offering (IPO) data extracted from RHP/DRHP documents into IPOVault.

Both the backend importer (`AdminIpoService.importIpoFromJson`) and the offline React Native manual entry form (`AddIPOManualScreen`) conform to this specification.

---

## Core Guidelines & Precision Rules

1. **Units & Precision**:
   - **Issue & Corporate Monetary Sizes**: Specified in **INR Crores (₹ Cr)** (e.g., `3668.50` represents ₹3,668.50 Crores). Applies to `issueSize`, `freshIssueSize`, `ofsSize`, `totalAssets`, `totalRevenue`, `pat`, `ebitda`, `netWorth`, `minAmount`, `maxAmount`.
   - **Per-Share Monetary Values**: Specified in **INR (₹)** per share (e.g., `350.00` represents ₹350/share). Applies to `priceBandMin`, `priceBandMax`, `faceValue`, `gmpAmount`, `eps`.
   - **Share Counts**: Specified as **absolute numbers** (e.g., `104800000` shares). Applies to `issueShareCount`, `freshIssueShareCount`, `ofsShareCount`, `minShares`, `maxShares`, `sharesBid`, `sharesOffered`.
   - **Percentages & Ratios**: Specified as plain numbers (e.g., `12.86` represents `12.86%`). Applies to `gmpPercent`, `allocationPct`, `roePercent`, `rocePercentage`, `patPercent`, `ebitdaPercent`.
   - **Dates**: Specified in **ISO 8601 YYYY-MM-DD format** (e.g., `"2026-09-16"`).

2. **Null Preservation & Strict Truthfulness**:
   - Missing or unknown values **MUST be explicit `null` or omitted**.
   - **NEVER** supply default zeros (`0`) or placeholder strings (`"N/A"`) for missing data.
   - **NEVER** fabricate or infer price bands, lot sizes, GMP, subscription multiples, allocation limits, or financial ratios if they are not explicitly present in the source RHP/DRHP.
   - Official RHP/DRHP source values take absolute precedence over assumptions.

3. **Flexibility & Alias Support**:
   - Field names are aligned with the Manual IPO form for ease of entry (e.g., `priceBandMin`, `issueType`, `companyPhone`, `gmpAmount`).
   - The importer automatically resolves both top-level intuitive shortcuts and canonical nested objects (`company`, `ipo`, `lifecycle`, `allotmentConfig`, `gmp`).

---

## Detailed Schema Specification

### Top-Level Properties

| Field Name | Type | Meaning | Unit / Format | Required? | Importer Mapping |
|---|---|---|---|---|---|
| `companyName` | `string` | Official legal/display name of the issuer company | Text | **Required** (if `company.legalName` absent) | `Company.legalName`, `Company.displayName` |
| `ipoName` | `string` | Marketing/display title of the IPO | Text | Optional | Defaults to `${companyName} IPO` |
| `logoUrl` | `string` | Public URL for company logo | URL string | Optional | `Company.logoUrl` |
| `symbol` | `string` | Ticker symbol on NSE/BSE | Uppercase text | Optional | `Ipo.symbol` |
| `exchange` | `string` | Stock exchanges for listing | `'NSE'`, `'BSE'`, `'BSE / NSE'`, `'BOTH'` | Optional | `Ipo.exchange` (`NSE`, `BSE`, `BOTH`) |
| `issueType` | `string` | Market classification / segment | `'Mainboard'`, `'SME'`, `'MAINBOARD'` | Optional | `Ipo.marketSegment` (`MAINBOARD`, `SME`) |
| `sector` | `string` | Business sector | Text | Optional | `Company.sector` |
| `industry` | `string` | Business industry | Text | Optional | `Company.industry` |
| `priceBandMin` | `number` | Minimum floor price of price band | ₹ per share | Optional | `Ipo.priceBandLow` |
| `priceBandMax` | `number` | Maximum cap price of price band | ₹ per share | Optional | `Ipo.priceBandHigh` |
| `lotSize` | `integer` | Bidding lot size (shares count per lot) | Integer | Optional | `Ipo.lotSize` |
| `issueSize` | `number` | Total size of the issue | ₹ Crores | Optional | `Ipo.issueSize` |
| `gmpAmount` | `number` | Grey Market Premium per share | ₹ per share | Optional | `GmpObservation.gmpAmount` |
| `gmpPercent` | `number` | Grey Market Premium percentage | Percentage (%) | Optional | `GmpObservation.gmpPercentage` |
| `openDate` | `string` | Bidding start date | `YYYY-MM-DD` | Optional | `IpoLifecycleEvent` (`OPEN`) |
| `closeDate` | `string` | Bidding end date | `YYYY-MM-DD` | Optional | `IpoLifecycleEvent` (`CLOSE`) |
| `allotmentDate` | `string` | Basis of allotment date | `YYYY-MM-DD` | Optional | `IpoLifecycleEvent` (`BASIS_OF_ALLOTMENT`) |
| `listingDate` | `string` | Listing date on exchanges | `YYYY-MM-DD` | Optional | `IpoLifecycleEvent` (`LISTING`) |
| `registrar` | `string` | Name of IPO Registrar | Text | Optional | `IpoAllotmentConfig.registrar` & `IpoParticipant` (`REGISTRAR`) |
| `registrarPhone` | `string` | Registrar contact phone | Phone string | Optional | `IpoParticipant.phone` |
| `registrarEmail` | `string` | Registrar contact email | Email string | Optional | `IpoParticipant.email` |
| `leadManager` | `string` | Book Running Lead Manager (BRLM) | Text | Optional | `IpoParticipant` (`BRLM`) |
| `website` | `string` | Issuer company website | URL string | Optional | `Company.website` |
| `companyPhone` | `string` | Issuer contact phone | Phone string | Optional | `Company.phone` |
| `companyEmail` | `string` | Issuer contact email | Email string | Optional | `Company.email` |
| `drhpUrl` | `string` | Draft Red Herring Prospectus PDF URL | URL string | Optional | `IpoDocument` (`DRHP`) |
| `rhpUrl` | `string` | Red Herring Prospectus PDF URL | URL string | Optional | `IpoDocument` (`RHP`) |
| `notes` | `string` | Profile description / notes | Text | Optional | `Company.aboutDescription` |

---

### Nested Object Structure (`company`)

| Field Name | Type | Meaning | Unit / Format | Required? | Importer Mapping |
|---|---|---|---|---|---|
| `company.legalName` | `string` | Legal corporate name | Text | **Required** (if `companyName` absent) | `Company.legalName` |
| `company.displayName` | `string` | Preferred display name | Text | Optional | `Company.displayName` |
| `company.cin` | `string` | Corporate Identification Number | Uppercase Text | Optional | `Company.cin` |
| `company.contactPerson` | `string` | Official contact person | Text | Optional | `Company.contactPerson` |
| `company.logoUrl` | `string` | Logo image URL | URL string | Optional | `Company.logoUrl` |
| `company.financials[]` | `array` | Financial history records | Array of objects | Optional | `CompanyFinancial` records |

#### Items in `company.financials[]` Array:

| Field Name | Type | Meaning | Unit / Format | Required? | Importer Mapping |
|---|---|---|---|---|---|
| `fiscalPeriod` | `string` | Financial period name (e.g. `"FY24"`, `"Q1FY25"`) | Text | **Required** | `CompanyFinancial.fiscalPeriod` |
| `periodType` | `string` | Period classification | `"ANNUAL"`, `"QUARTERLY"`, `"HALF_YEARLY"` | Optional (default `"ANNUAL"`) | `CompanyFinancial.periodType` |
| `totalAssets` | `number` | Total company assets | ₹ Crores | Optional | `CompanyFinancial.totalAssets` |
| `totalRevenue` (or `revenue`) | `number` | Total revenue / income | ₹ Crores | Optional | `CompanyFinancial.totalRevenue` |
| `pat` (or `netProfit`) | `number` | Profit After Tax | ₹ Crores | Optional | `CompanyFinancial.pat` |
| `ebitda` | `number` | Operating Profit (EBITDA) | ₹ Crores | Optional | `CompanyFinancial.ebitda` |
| `netWorth` (or `nav`, `ronw`) | `number` | Net worth / NAV | ₹ Crores | Optional | `CompanyFinancial.netWorth` |
| `roePercent` (or `roePercentage`) | `number` | Return on Equity ratio | Percentage (%) | Optional | `CompanyFinancial.roePercentage` |
| `rocePercentage` | `number` | Return on Capital Employed | Percentage (%) | Optional | `CompanyFinancial.rocePercentage` |
| `eps` | `number` | Earnings Per Share | ₹ per share | Optional | `CompanyFinancial.eps` |
| `patPercent` (or `patMarginPercent`)| `number` | Profit After Tax Margin | Percentage (%) | Optional | `CompanyFinancial.patMarginPercent` |

---

### Nested Object Structure (`ipo`)

| Field Name | Type | Meaning | Unit / Format | Required? | Importer Mapping |
|---|---|---|---|---|---|
| `ipo.faceValue` | `number` | Nominal value per share | ₹ per share | Optional | `Ipo.faceValue` |
| `ipo.freshIssueSize` | `number` | Size of new shares issuance | ₹ Crores | Optional | `Ipo.freshIssueSize` |
| `ipo.ofsSize` | `number` | Size of Offer for Sale shares | ₹ Crores | Optional | `Ipo.ofsSize` |
| `ipo.issueShareCount` | `number` | Total shares in IPO | Absolute shares count | Optional | `Ipo.issueShareCount` |
| `ipo.freshIssueShareCount`| `number` | Fresh shares count | Absolute shares count | Optional | `Ipo.freshIssueShareCount` |
| `ipo.ofsShareCount` | `number` | OFS shares count | Absolute shares count | Optional | `Ipo.ofsShareCount` |

---

### Category Allocations (`offerCategories[]`)

| Field Name | Type | Meaning | Unit / Format | Required? | Importer Mapping |
|---|---|---|---|---|---|
| `category` | `string` | Investor reservation category | `"QIB"`, `"NII"`, `"RETAIL"`, `"EMPLOYEE"`, `"SHAREHOLDER"` | **Required** | `IpoOfferCategory.category` |
| `allocationPct` | `number` | Reserved share percentage | Percentage (%) | Optional | `IpoOfferCategory.allocationPct` |
| `minLots` | `integer` | Minimum lot requirement | Integer lots | Optional | `IpoOfferCategory.minLots` |
| `maxLots` | `integer` | Maximum lot limit | Integer lots | Optional | `IpoOfferCategory.maxLots` |
| `minShares` | `integer` | Minimum shares count | Integer shares | Optional | `IpoOfferCategory.minShares` |
| `maxShares` | `integer` | Maximum shares count | Integer shares | Optional | `IpoOfferCategory.maxShares` |
| `minAmount` | `number` | Minimum application amount | ₹ Crores | Optional | `IpoOfferCategory.minAmount` |
| `maxAmount` | `number` | Maximum application amount | ₹ Crores | Optional | `IpoOfferCategory.maxAmount` |
| `isUpiEligible` | `boolean` | UPI bidding eligibility | Boolean | Optional (default `true`) | `IpoOfferCategory.isUpiEligible` |

---

### Category Subscription Bids (`subscription[]`)

| Field Name | Type | Meaning | Unit / Format | Required? | Importer Mapping |
|---|---|---|---|---|---|
| `category` | `string` | Investor category | `"QIB"`, `"NII"`, `"RETAIL"`, `"EMPLOYEE"`, `"SHAREHOLDER"` | **Required** | `SubscriptionObservation.category` |
| `subscriptionMultiple` | `number` | Bidding subscription times | Multiple (e.g. `12.45` for 12.45x) | **Required** | `SubscriptionObservation.subscriptionMultiple` |
| `sharesBid` | `number` | Total shares bid | Absolute shares count | Optional | `SubscriptionObservation.sharesBid` |
| `sharesOffered` | `number` | Total shares offered | Absolute shares count | Optional | `SubscriptionObservation.sharesOffered` |
| `observedAt` | `string` | Timestamp of observation | ISO 8601 string | Optional | `SubscriptionObservation.observedAt` |

---

## Comprehensive Structural JSON Example

> [!IMPORTANT]
> **Illustrative Example Notice**: All data values shown in the example below are purely illustrative and intended only to demonstrate schema nesting and syntax.

```json
{
  "meta": {
    "version": "1.0",
    "sourceSystem": "RHP_PARSER_V1",
    "exportedAt": "2026-09-14T12:00:00Z"
  },

  "ipoName": "Hero Fincorp Limited IPO",
  "companyName": "Hero Fincorp Limited",
  "logoUrl": "https://example.com/logos/hero-fincorp.png",
  "symbol": "HEROFIN",
  "exchange": "BSE / NSE",
  "issueType": "Mainboard",
  "sector": "Financial Services",
  "industry": "Non-Banking Financial Company (NBFC)",

  "priceBandMin": 325.00,
  "priceBandMax": 350.00,
  "lotSize": 40,
  "issueSize": 3668.00,

  "gmpAmount": 45.00,
  "gmpPercent": 12.86,

  "openDate": "2026-09-16",
  "closeDate": "2026-09-18",
  "allotmentDate": "2026-09-21",
  "listingDate": "2026-09-23",

  "registrar": "KFin Technologies Limited",
  "registrarPhone": "+91 40 6716 2222",
  "registrarEmail": "herofincorp.ipo@kfintech.com",
  "leadManager": "ICICI Securities Limited",

  "website": "https://www.herofincorp.com",
  "companyPhone": "+91 11 4948 7100",
  "companyEmail": "investors@herofincorp.com",

  "drhpUrl": "https://example.com/docs/hero_fincorp_drhp.pdf",
  "rhpUrl": "https://example.com/docs/hero_fincorp_rhp.pdf",
  "notes": "Leading NBFC with strong retail automotive and personal loan portfolio.",

  "company": {
    "cin": "U65929DL1991PLC046774",
    "contactPerson": "Shivangi Agarwal",
    "financials": [
      {
        "fiscalPeriod": "FY24",
        "periodType": "ANNUAL",
        "totalAssets": 48920.50,
        "totalRevenue": 4350.20,
        "pat": 640.80,
        "ebitda": 1120.40,
        "netWorth": 5820.00,
        "roePercent": 11.01,
        "rocePercentage": 13.40,
        "eps": 24.50,
        "patPercent": 14.73
      },
      {
        "fiscalPeriod": "FY23",
        "periodType": "ANNUAL",
        "totalAssets": 41200.00,
        "totalRevenue": 3680.10,
        "pat": 480.30,
        "ebitda": 950.20,
        "netWorth": 5100.00,
        "roePercent": 9.42,
        "rocePercentage": 11.80,
        "eps": 18.40,
        "patPercent": 13.05
      }
    ]
  },

  "ipo": {
    "faceValue": 10.00,
    "freshIssueSize": 2100.00,
    "ofsSize": 1568.00,
    "issueShareCount": 104800000,
    "freshIssueShareCount": 60000000,
    "ofsShareCount": 44800000
  },

  "offerCategories": [
    {
      "category": "QIB",
      "allocationPct": 50.0,
      "isUpiEligible": false
    },
    {
      "category": "NII",
      "allocationPct": 15.0,
      "isUpiEligible": true
    },
    {
      "category": "RETAIL",
      "allocationPct": 35.0,
      "minLots": 1,
      "maxLots": 13,
      "minShares": 40,
      "maxShares": 520,
      "minAmount": 14000,
      "maxAmount": 182000,
      "isUpiEligible": true
    }
  ],

  "subscription": [
    {
      "category": "QIB",
      "subscriptionMultiple": 12.45
    },
    {
      "category": "NII",
      "subscriptionMultiple": 8.30
    },
    {
      "category": "RETAIL",
      "subscriptionMultiple": 5.12
    }
  ]
}
```
