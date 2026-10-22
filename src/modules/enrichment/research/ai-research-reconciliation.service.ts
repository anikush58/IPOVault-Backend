import { Injectable } from '@nestjs/common';
import { ExchangeListing, IpoStatus, MarketSegment } from '@prisma/client';
import {
  FieldReconciliationDecision,
  IpoReconciliationSummary,
  IpoResearchCandidates,
  ResearchAgentDiagnostics,
  ResearchedCandidateField,
} from './research.types';

@Injectable()
export class AiResearchReconciliationService {

  /**
   * Reconciles researched candidate fields against current database values and existing provenance.
   */
  public reconcile(
    ipo: any,
    candidates: IpoResearchCandidates,
    existingProvenances: any[] = [],
  ): IpoReconciliationSummary {
    const decisions: FieldReconciliationDecision[] = [];
    const provByField = this.mapExistingProvenances(existingProvenances);
    const candidatesDiagnostics = candidates?.diagnostics;

    const comp = ipo.company || {};
    const events = ipo.lifecycleEvents || [];
    const openEvt = events.find((e: any) => e.eventType === 'OPEN');
    const closeEvt = events.find((e: any) => e.eventType === 'CLOSE');
    const allotEvt = events.find((e: any) => e.eventType === 'BASIS_OF_ALLOTMENT');
    const refundEvt = events.find((e: any) => e.eventType === 'REFUND_INITIATION');
    const listEvt = events.find((e: any) => e.eventType === 'LISTING');
    const allotCfg = ipo.allotmentConfig || {};

    const rField = (params: {
      fieldKey: string;
      fieldLabel: string;
      entityType: FieldReconciliationDecision['entityType'];
      currentValue: any;
      candidate?: ResearchedCandidateField;
      provByField: Map<string, any>;
      decisions: FieldReconciliationDecision[];
      normalizer: (val: any) => any;
    }) => this.reconcileField({ ...params, candidatesDiagnostics });

    // 1. Company Fields
    rField({
      fieldKey: 'company.legalName',
      fieldLabel: 'Company Legal Name',
      entityType: 'COMPANY',
      currentValue: comp.legalName,
      candidate: candidates.legalName,
      provByField,
      decisions,
      normalizer: this.normalizeString,
    });

    rField({
      fieldKey: 'company.displayName',
      fieldLabel: 'Company Display Name',
      entityType: 'COMPANY',
      currentValue: comp.displayName,
      candidate: candidates.displayName,
      provByField,
      decisions,
      normalizer: this.normalizeString,
    });

    rField({
      fieldKey: 'company.cin',
      fieldLabel: 'CIN',
      entityType: 'COMPANY',
      currentValue: comp.cin,
      candidate: candidates.cin,
      provByField,
      decisions,
      normalizer: this.normalizeCin,
    });

    rField({
      fieldKey: 'company.website',
      fieldLabel: 'Company Website',
      entityType: 'COMPANY',
      currentValue: comp.website,
      candidate: candidates.website,
      provByField,
      decisions,
      normalizer: this.normalizeUrl,
    });

    rField({
      fieldKey: 'company.aboutDescription',
      fieldLabel: 'About Company',
      entityType: 'COMPANY',
      currentValue: comp.aboutDescription,
      candidate: candidates.aboutDescription,
      provByField,
      decisions,
      normalizer: this.normalizeString,
    });

    rField({
      fieldKey: 'company.sector',
      fieldLabel: 'Sector',
      entityType: 'COMPANY',
      currentValue: comp.sector,
      candidate: candidates.sector,
      provByField,
      decisions,
      normalizer: this.normalizeString,
    });

    rField({
      fieldKey: 'company.industry',
      fieldLabel: 'Industry',
      entityType: 'COMPANY',
      currentValue: comp.industry,
      candidate: candidates.industry,
      provByField,
      decisions,
      normalizer: this.normalizeString,
    });

    // 2. Core IPO Parameters
    rField({
      fieldKey: 'marketSegment',
      fieldLabel: 'Market Segment',
      entityType: 'IPO',
      currentValue: ipo.marketSegment,
      candidate: candidates.marketSegment,
      provByField,
      decisions,
      normalizer: this.normalizeMarketSegment,
    });

    rField({
      fieldKey: 'exchange',
      fieldLabel: 'Exchange Listing',
      entityType: 'IPO',
      currentValue: ipo.exchange,
      candidate: candidates.exchange,
      provByField,
      decisions,
      normalizer: this.normalizeExchange,
    });

    rField({
      fieldKey: 'status',
      fieldLabel: 'IPO Status',
      entityType: 'IPO',
      currentValue: ipo.status,
      candidate: candidates.status,
      provByField,
      decisions,
      normalizer: this.normalizeIpoStatus,
    });

    rField({
      fieldKey: 'symbol',
      fieldLabel: 'Symbol',
      entityType: 'IPO',
      currentValue: ipo.symbol,
      candidate: candidates.symbol,
      provByField,
      decisions,
      normalizer: this.normalizeSymbol,
    });

    rField({
      fieldKey: 'isin',
      fieldLabel: 'ISIN',
      entityType: 'IPO',
      currentValue: ipo.isin,
      candidate: candidates.isin,
      provByField,
      decisions,
      normalizer: this.normalizeIsin,
    });

    // 3. Issue Structure & Pricing
    rField({
      fieldKey: 'priceBandLow',
      fieldLabel: 'Price Band Low (₹)',
      entityType: 'IPO',
      currentValue: ipo.priceBandLow != null ? Number(ipo.priceBandLow) : null,
      candidate: candidates.priceBandLow,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'priceBandHigh',
      fieldLabel: 'Price Band High (₹)',
      entityType: 'IPO',
      currentValue: ipo.priceBandHigh != null ? Number(ipo.priceBandHigh) : null,
      candidate: candidates.priceBandHigh,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'lotSize',
      fieldLabel: 'Lot Size (Shares)',
      entityType: 'IPO',
      currentValue: ipo.lotSize,
      candidate: candidates.lotSize,
      provByField,
      decisions,
      normalizer: this.normalizeInteger,
    });

    rField({
      fieldKey: 'faceValue',
      fieldLabel: 'Face Value (₹)',
      entityType: 'IPO',
      currentValue: ipo.faceValue != null ? Number(ipo.faceValue) : null,
      candidate: candidates.faceValue,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'issueSize',
      fieldLabel: 'Issue Size (₹ Cr)',
      entityType: 'IPO',
      currentValue: ipo.issueSize != null ? Number(ipo.issueSize) : null,
      candidate: candidates.issueSize,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'freshIssueSize',
      fieldLabel: 'Fresh Issue Size (₹ Cr)',
      entityType: 'IPO',
      currentValue: ipo.freshIssueSize != null ? Number(ipo.freshIssueSize) : null,
      candidate: candidates.freshIssueSize,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'ofsSize',
      fieldLabel: 'OFS Size (₹ Cr)',
      entityType: 'IPO',
      currentValue: ipo.ofsSize != null ? Number(ipo.ofsSize) : null,
      candidate: candidates.ofsSize,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'issueShareCount',
      fieldLabel: 'Total Issue Shares',
      entityType: 'IPO',
      currentValue: ipo.issueShareCount != null ? Number(ipo.issueShareCount) : null,
      candidate: candidates.issueShareCount,
      provByField,
      decisions,
      normalizer: this.normalizeInteger,
    });

    rField({
      fieldKey: 'freshIssueShareCount',
      fieldLabel: 'Fresh Issue Shares',
      entityType: 'IPO',
      currentValue: ipo.freshIssueShareCount != null ? Number(ipo.freshIssueShareCount) : null,
      candidate: candidates.freshIssueShareCount,
      provByField,
      decisions,
      normalizer: this.normalizeInteger,
    });

    rField({
      fieldKey: 'ofsShareCount',
      fieldLabel: 'OFS Shares',
      entityType: 'IPO',
      currentValue: ipo.ofsShareCount != null ? Number(ipo.ofsShareCount) : null,
      candidate: candidates.ofsShareCount,
      provByField,
      decisions,
      normalizer: this.normalizeInteger,
    });

    // 4. Lifecycle Dates
    rField({
      fieldKey: 'openDate',
      fieldLabel: 'Issue Open Date',
      entityType: 'LIFECYCLE',
      currentValue: openEvt ? openEvt.eventDate.toISOString().slice(0, 10) : null,
      candidate: candidates.openDate,
      provByField,
      decisions,
      normalizer: this.normalizeDate,
    });

    rField({
      fieldKey: 'closeDate',
      fieldLabel: 'Issue Close Date',
      entityType: 'LIFECYCLE',
      currentValue: closeEvt ? closeEvt.eventDate.toISOString().slice(0, 10) : null,
      candidate: candidates.closeDate,
      provByField,
      decisions,
      normalizer: this.normalizeDate,
    });

    rField({
      fieldKey: 'allotmentDate',
      fieldLabel: 'Basis of Allotment Date',
      entityType: 'LIFECYCLE',
      currentValue: allotEvt ? allotEvt.eventDate.toISOString().slice(0, 10) : null,
      candidate: candidates.allotmentDate,
      provByField,
      decisions,
      normalizer: this.normalizeDate,
    });

    rField({
      fieldKey: 'refundDate',
      fieldLabel: 'Refund Initiation Date',
      entityType: 'LIFECYCLE',
      currentValue: refundEvt ? refundEvt.eventDate.toISOString().slice(0, 10) : null,
      candidate: candidates.refundDate,
      provByField,
      decisions,
      normalizer: this.normalizeDate,
    });

    rField({
      fieldKey: 'listingDate',
      fieldLabel: 'Listing Date',
      entityType: 'LIFECYCLE',
      currentValue: listEvt ? listEvt.eventDate.toISOString().slice(0, 10) : null,
      candidate: candidates.listingDate,
      provByField,
      decisions,
      normalizer: this.normalizeDate,
    });

    // 5. Registrar & Allotment
    rField({
      fieldKey: 'registrarName',
      fieldLabel: 'Registrar Name',
      entityType: 'ALLOTMENT_CONFIG',
      currentValue: allotCfg.registrar || null,
      candidate: candidates.registrarName,
      provByField,
      decisions,
      normalizer: this.normalizeRegistrar,
    });

    rField({
      fieldKey: 'registrarIpoCode',
      fieldLabel: 'Registrar IPO Code',
      entityType: 'ALLOTMENT_CONFIG',
      currentValue: allotCfg.registrarIpoCode || null,
      candidate: candidates.registrarIpoCode,
      provByField,
      decisions,
      normalizer: this.normalizeString,
    });

    // 6. Valuation & Shareholding
    rField({
      fieldKey: 'preIpoPe',
      fieldLabel: 'Pre-IPO P/E',
      entityType: 'IPO',
      currentValue: ipo.preIpoPe != null ? Number(ipo.preIpoPe) : null,
      candidate: candidates.preIpoPe,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'postIpoPe',
      fieldLabel: 'Post-IPO P/E',
      entityType: 'IPO',
      currentValue: ipo.postIpoPe != null ? Number(ipo.postIpoPe) : null,
      candidate: candidates.postIpoPe,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'preIpoPromoterHolding',
      fieldLabel: 'Pre-IPO Promoter Holding (%)',
      entityType: 'IPO',
      currentValue: ipo.preIpoPromoterHolding != null ? Number(ipo.preIpoPromoterHolding) : null,
      candidate: candidates.preIpoPromoterHolding,
      provByField,
      decisions,
      normalizer: this.normalizePercentage,
    });

    rField({
      fieldKey: 'postIpoPromoterHolding',
      fieldLabel: 'Post-IPO Promoter Holding (%)',
      entityType: 'IPO',
      currentValue: ipo.postIpoPromoterHolding != null ? Number(ipo.postIpoPromoterHolding) : null,
      candidate: candidates.postIpoPromoterHolding,
      provByField,
      decisions,
      normalizer: this.normalizePercentage,
    });

    // 7. Listing Performance
    rField({
      fieldKey: 'listingPrice',
      fieldLabel: 'Listing Price (₹)',
      entityType: 'IPO',
      currentValue: ipo.listingPrice != null ? Number(ipo.listingPrice) : null,
      candidate: candidates.listingPrice,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    rField({
      fieldKey: 'listingGainPct',
      fieldLabel: 'Listing Gain (%)',
      entityType: 'IPO',
      currentValue: ipo.listingGainPct != null ? Number(ipo.listingGainPct) : null,
      candidate: candidates.listingGainPct,
      provByField,
      decisions,
      normalizer: this.normalizeNumber,
    });

    const verifiedUpdatesCount = decisions.filter((d) => d.status === 'VERIFIED_UPDATE').length;
    const unchangedCount = decisions.filter((d) => d.status === 'UNCHANGED').length;
    const protectedCount = decisions.filter((d) => d.status === 'PROTECTED').length;
    const conflictsCount = decisions.filter((d) => d.status === 'CONFLICTING_SOURCES').length;
    const unverifiableCount = decisions.filter((d) => d.status === 'UNVERIFIABLE').length;
    const skippedCount = decisions.filter((d) => d.status === 'SKIPPED').length;
    const missingCount = decisions.filter((d) => d.status === 'MISSING_VALUE').length;
    const appliedCount = decisions.filter((d) => d.autoApply).length;

    const missingFieldsDetected = decisions.filter((d) => this.isPlaceholderOrEmpty(d.currentValue)).length;
    const verifiedCandidatesCount = decisions.filter((d) => d.candidateValue !== null && d.status === 'VERIFIED_UPDATE').length;

    const diag = candidates?.diagnostics;
    const diagnosticCode = diag?.diagnosticCode || (diag?.status === 'SUCCESS' ? 'SUCCESS' : undefined);
    const diagnosticMessage = diag?.errorMessage;

    return {
      ipoId: ipo.id,
      companyName: comp.displayName || comp.legalName || 'Unknown IPO',
      evaluatedAt: new Date().toISOString(),
      recordsEvaluated: 1,
      fieldsInspected: decisions.length,
      fieldsEvaluated: decisions.length,
      missingFieldsDetected,
      searchesAttempted: diag?.searchQueries?.length || 0,
      searchesCompleted: diag?.status === 'SUCCESS' ? (diag?.searchQueries?.length || 0) : 0,
      sourcesRetrievedCount: diag?.groundingSourcesCount || 0,
      verifiedCandidatesCount,
      verifiedUpdatesCount,
      valuesAppliedCount: appliedCount,
      appliedCount,
      valuesUnchangedCount: unchangedCount,
      unchangedCount,
      protectedCount,
      conflictsCount,
      unverifiableCount,
      skippedCount,
      missingCount,
      providerFailuresCount: diag?.status === 'FAILED' ? 1 : 0,
      persistenceFailuresCount: 0,
      diagnosticCode,
      diagnosticMessage,
      decisions,
    };
  }

  /**
   * Evaluates a single candidate field against existing database value and provenance.
   */
  private reconcileField(params: {
    fieldKey: string;
    fieldLabel: string;
    entityType: FieldReconciliationDecision['entityType'];
    currentValue: any;
    candidate?: ResearchedCandidateField;
    provByField: Map<string, any>;
    decisions: FieldReconciliationDecision[];
    normalizer: (val: any) => any;
    candidatesDiagnostics?: ResearchAgentDiagnostics;
  }) {
    const {
      fieldKey,
      fieldLabel,
      entityType,
      currentValue,
      candidate,
      provByField,
      decisions,
      normalizer,
      candidatesDiagnostics,
    } = params;

    const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedCurrent = normalizer(currentValue);
    const existingProv = provByField.get(normKey(fieldKey)) || provByField.get(fieldKey.toLowerCase());
    const isCurrentPresent = !this.isPlaceholderOrEmpty(normalizedCurrent);

    const displayCurrent =
      normalizedCurrent !== null && normalizedCurrent !== undefined && String(normalizedCurrent).trim() !== ''
        ? String(normalizedCurrent)
        : '(None)';

    // Source info fallback when no candidate is available
    const existingSourceUrl = existingProv?.reference || '';
    const existingSourceAuthority = existingProv?.tier || (existingProv?.priority === 1 ? 'TIER_1_STATUTORY' : existingProv?.priority === 2 ? 'TIER_1_STATUTORY' : undefined);
    const existingEvidence = existingProv ? `Recorded in database via ${existingProv.sourceLabel}` : undefined;

    // Case 1: Research produced no candidate value
    if (!candidate || candidate.rawValue === null || candidate.rawValue === undefined) {
      const isUpstreamFailure = candidatesDiagnostics?.status === 'FAILED';

      if (isCurrentPresent) {
        decisions.push({
          fieldKey,
          fieldLabel,
          entityType,
          currentValue: normalizedCurrent,
          currentValueDisplay: displayCurrent,
          existingProvenance: existingProv,
          candidateValue: null,
          candidateValueDisplay: isUpstreamFailure ? '(Skipped)' : '(Current Value Preserved)',
          status: isUpstreamFailure ? 'SKIPPED' : 'UNCHANGED',
          diagnosticCode: isUpstreamFailure
            ? (candidatesDiagnostics?.diagnosticCode || 'UPSTREAM_API_ERROR')
            : 'DATABASE_VALUE_PRESERVED',
          statusReason: isUpstreamFailure
            ? `Research skipped: Upstream AI search failed (${candidatesDiagnostics?.errorMessage || candidatesDiagnostics?.diagnosticCode || 'API error'}). Current database value preserved.`
            : 'Current database value is verified and was not modified by research.',
          sourceUrl: existingSourceUrl,
          sourceAuthority: existingSourceAuthority,
          evidence: existingEvidence,
          autoApply: false,
          applied: false,
        });
      } else {
        decisions.push({
          fieldKey,
          fieldLabel,
          entityType,
          currentValue: normalizedCurrent,
          currentValueDisplay: displayCurrent,
          existingProvenance: existingProv,
          candidateValue: null,
          candidateValueDisplay: isUpstreamFailure ? '(Skipped)' : '(Not Found)',
          status: isUpstreamFailure ? 'SKIPPED' : 'MISSING_VALUE',
          diagnosticCode: isUpstreamFailure
            ? (candidatesDiagnostics?.diagnosticCode || 'UPSTREAM_API_ERROR')
            : 'FIELD_NOT_REPORTED_BY_SOURCES',
          statusReason: isUpstreamFailure
            ? `Research skipped: Upstream AI search failed (${candidatesDiagnostics?.errorMessage || candidatesDiagnostics?.diagnosticCode || 'API error'}). Field remains missing.`
            : 'Field is missing in database and was not disclosed in the researched official statutory filings or registrar records.',
          sourceUrl: existingSourceUrl,
          sourceAuthority: existingSourceAuthority,
          evidence: existingEvidence,
          autoApply: false,
          applied: false,
        });
      }
      return;
    }

    const normalizedCandidate = normalizer(candidate.rawValue);
    const displayCandidate =
      normalizedCandidate !== null && normalizedCandidate !== undefined ? String(normalizedCandidate) : '(Null)';

    if (normalizedCandidate === null) {
      decisions.push({
        fieldKey,
        fieldLabel,
        entityType,
        currentValue: normalizedCurrent,
        currentValueDisplay: displayCurrent,
        existingProvenance: existingProv,
        candidateValue: null,
        candidateValueDisplay: '(Invalid/Null)',
        status: isCurrentPresent ? 'UNVERIFIABLE' : 'MISSING_VALUE',
        diagnosticCode: 'NORMALIZATION_FAILED',
        statusReason: isCurrentPresent
          ? `Candidate value '${String(candidate.rawValue)}' could not be normalized to valid schema format. Current database value preserved.`
          : `Candidate value '${String(candidate.rawValue)}' could not be normalized to valid schema format. Field remains missing.`,
        sourceUrl: candidate.sourceUrl || existingSourceUrl,
        sourceAuthority: candidate.sourceAuthority || existingSourceAuthority,
        evidence: candidate.evidence || existingEvidence,
        confidence: candidate.confidence,
        autoApply: false,
        applied: false,
      });
      return;
    }

    // Compare normalized values
    const isEquivalent = this.isValuesEquivalent(fieldKey, normalizedCurrent, normalizedCandidate);

    // Case 2: Values match
    if (isEquivalent) {
      decisions.push({
        fieldKey,
        fieldLabel,
        entityType,
        currentValue: normalizedCurrent,
        currentValueDisplay: displayCurrent,
        existingProvenance: existingProv,
        candidateValue: normalizedCandidate,
        candidateValueDisplay: displayCandidate,
        status: 'UNCHANGED',
        diagnosticCode: 'SUCCESS',
        statusReason: 'Current database value matches researched candidate.',
        sourceUrl: candidate.sourceUrl,
        sourceAuthority: candidate.sourceAuthority,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        autoApply: false,
        applied: false,
      });
      return;
    }

    // Case 3: Values differ - analyze provenance and source authority
    const existingCode = (existingProv?.sourceCode || '').toUpperCase();
    const isExistingManual =
      existingCode === 'ADMIN' ||
      existingCode === 'MANUAL' ||
      existingCode.includes('MANUAL') ||
      existingProv?.priority === 1;

    const isExistingOfficial =
      existingCode === 'OFFICIAL' ||
      existingCode === 'NSE' ||
      existingCode === 'BSE' ||
      existingCode === 'SEBI' ||
      existingCode === 'REGISTRAR' ||
      existingProv?.priority === 2;

    const isCandidateAuthoritative =
      candidate.sourceAuthority === 'TIER_1_STATUTORY' ||
      candidate.sourceAuthority === 'TIER_2_REGISTRAR' ||
      candidate.sourceAuthority === 'TIER_3_ISSUER';

    // Rule: Never overwrite Admin Manual entries
    if (isExistingManual) {
      decisions.push({
        fieldKey,
        fieldLabel,
        entityType,
        currentValue: normalizedCurrent,
        currentValueDisplay: displayCurrent,
        existingProvenance: existingProv,
        candidateValue: normalizedCandidate,
        candidateValueDisplay: displayCandidate,
        status: 'PROTECTED',
        diagnosticCode: 'CONFLICTS_WITH_ADMIN_LOCK',
        statusReason: 'Protected by Manual/Admin entry. Candidate differs from verified human review.',
        sourceUrl: candidate.sourceUrl,
        sourceAuthority: candidate.sourceAuthority,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        autoApply: false,
        applied: false,
      });
      return;
    }

    // Rule: If candidate is weak secondary and conflicts with official data, do not overwrite
    if (isExistingOfficial && !isCandidateAuthoritative) {
      decisions.push({
        fieldKey,
        fieldLabel,
        entityType,
        currentValue: normalizedCurrent,
        currentValueDisplay: displayCurrent,
        existingProvenance: existingProv,
        candidateValue: normalizedCandidate,
        candidateValueDisplay: displayCandidate,
        status: 'PROTECTED',
        diagnosticCode: 'CONFLICTS_WITH_OFFICIAL_DATA',
        statusReason: `Secondary candidate cannot overwrite official statutory exchange/SEBI filing. Source (${candidate.sourceDomain || 'secondary'}) is not authoritative.`,
        sourceUrl: candidate.sourceUrl,
        sourceAuthority: candidate.sourceAuthority,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        autoApply: false,
        applied: false,
      });
      return;
    }

    // Rule: If candidate is from low confidence/tier 4 secondary without official evidence
    if (!isCandidateAuthoritative || candidate.confidence < 0.75) {
      const diagCode = !isCandidateAuthoritative ? 'UNTRUSTED_SECONDARY_SOURCE' : 'BELOW_CONFIDENCE_THRESHOLD';
      const reason = !isCandidateAuthoritative
        ? `Source (${candidate.sourceDomain || 'secondary'}) is secondary or unverified for official statutory parameters.`
        : `Candidate confidence score (${candidate.confidence}) is below threshold (0.75).`;

      decisions.push({
        fieldKey,
        fieldLabel,
        entityType,
        currentValue: normalizedCurrent,
        currentValueDisplay: displayCurrent,
        existingProvenance: existingProv,
        candidateValue: normalizedCandidate,
        candidateValueDisplay: displayCandidate,
        status: isCurrentPresent ? 'CONFLICTING_SOURCES' : 'UNVERIFIABLE',
        diagnosticCode: diagCode,
        statusReason: reason,
        sourceUrl: candidate.sourceUrl,
        sourceAuthority: candidate.sourceAuthority,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        autoApply: false,
        applied: false,
      });
      return;
    }

    // Qualified verified update:
    // Either DB is empty, or existing source was weaker commercial feed (e.g. IPOGURU),
    // and candidate is supported by authoritative filing
    decisions.push({
      fieldKey,
      fieldLabel,
      entityType,
      currentValue: normalizedCurrent,
      currentValueDisplay: displayCurrent,
      existingProvenance: existingProv,
      candidateValue: normalizedCandidate,
      candidateValueDisplay: displayCandidate,
      status: 'VERIFIED_UPDATE',
      diagnosticCode: 'SUCCESS',
      statusReason: isCurrentPresent
        ? `Verified update supported by ${candidate.sourceAuthority} (${candidate.sourceName || candidate.sourceDomain || 'authoritative source'}).`
        : `Verified candidate populates missing field via ${candidate.sourceAuthority} (${candidate.sourceName || candidate.sourceDomain || 'authoritative source'}).`,
      sourceUrl: candidate.sourceUrl,
      sourceAuthority: candidate.sourceAuthority,
      evidence: candidate.evidence,
      confidence: candidate.confidence,
      autoApply: true,
      applied: false, // will be marked true after commit
    });
  }

  public isValuesEquivalent(fieldKey: string, a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;

    if (typeof a === 'number' && typeof b === 'number') {
      return Math.abs(a - b) < 0.001;
    }

    if (fieldKey.includes('legalName') || fieldKey.includes('displayName')) {
      const normA = this.normalizeCompanyName(String(a));
      const normB = this.normalizeCompanyName(String(b));
      if (normA && normB && normA === normB) return true;
    }

    if (fieldKey.includes('cin')) {
      const cinA = String(a).replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const cinB = String(b).replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (cinA && cinB && cinA === cinB) return true;
    }

    const sa = String(a).trim().replace(/\s+/g, ' ').toLowerCase();
    const sb = String(b).trim().replace(/\s+/g, ' ').toLowerCase();
    return sa === sb;
  }

  private mapExistingProvenances(existing: any[]): Map<string, any> {
    const map = new Map<string, any>();
    const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const p of existing) {
      const code = (p.source?.code || '').toUpperCase();
      let priority = 4;
      let sourceLabel = p.source?.name || code;

      if (code === 'ADMIN' || code === 'MANUAL' || code.includes('MANUAL')) {
        priority = 1;
        sourceLabel = 'Admin Manual Review';
      } else if (['OFFICIAL', 'NSE', 'BSE', 'SEBI', 'REGISTRAR'].includes(code)) {
        priority = 2;
      } else if (code.includes('IPOGURU')) {
        priority = 3;
        sourceLabel = 'IPOGuru Feed';
      }

      const item = {
        sourceCode: code,
        sourceType: p.source?.sourceType,
        sourceLabel,
        priority,
        reference: p.sourceReference,
        tier: p.tier,
        value: p.value,
      };

      if (p.fieldName) {
        map.set((p.fieldName || '').toLowerCase(), item);
        map.set(normKey(p.fieldName), item);
      }
    }
    return map;
  }

  // ==========================================
  // NORMALIZATION HELPERS
  // ==========================================

  public normalizeString = (val: any): string | null => {
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    if (s.length === 0) return null;
    const lower = s.toLowerCase();
    const placeholders = [
      'n/a',
      'na',
      '-',
      '--',
      '---',
      'tbd',
      'tba',
      '[●]',
      '[•]',
      '●',
      '•',
      'null',
      'undefined',
      'to be announced',
      'to be determined',
      'not available',
      'not applicable',
      'none',
    ];
    return placeholders.includes(lower) ? null : s;
  };

  public normalizeNumber = (val: any): number | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return isNaN(val) ? null : Number(val.toFixed(2));
    const s = String(val).replace(/[^0-9.-]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : Number(n.toFixed(2));
  };

  public normalizeInteger = (val: any): number | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return Math.round(val);
    const s = String(val).replace(/[^0-9-]/g, '');
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  };

  public normalizePercentage = (val: any): number | null => {
    const num = this.normalizeNumber(val);
    if (num === null) return null;
    return Math.max(0, Math.min(100, num));
  };

  public normalizeDate = (val: any): string | null => {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    const s = String(val).trim();
    // Match YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // Try parsing Date
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  };

  public normalizeCin = (val: any): string | null => {
    if (!val) return null;
    const s = String(val).replace(/[^A-Z0-9]/gi, '').toUpperCase();
    return s.length === 21 ? s : null;
  };

  public normalizeCompanyName(name: string): string {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      .replace(/\b(limited|ltd|pvt|private|sme|ipo|ncds?|ncd|invit|reit|trust)\b/gi, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public isPlaceholderOrEmpty(val: any): boolean {
    if (val === null || val === undefined) return true;
    const s = String(val).trim();
    if (s.length === 0) return true;
    const lower = s.toLowerCase();
    const placeholders = [
      'n/a',
      'na',
      '-',
      '--',
      '---',
      'tbd',
      'tba',
      '[●]',
      '[•]',
      '●',
      '•',
      'null',
      'undefined',
      'to be announced',
      'to be determined',
      'not available',
      'not applicable',
      'none',
    ];
    return placeholders.includes(lower);
  }

  public normalizeUrl = (val: any): string | null => {
    if (!val) return null;
    const s = String(val).trim();
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    return `https://${s}`;
  };

  public normalizeMarketSegment = (val: any): MarketSegment | null => {
    if (!val) return null;
    const s = String(val).toUpperCase();
    if (s.includes('SME')) return MarketSegment.SME;
    if (s.includes('MAIN')) return MarketSegment.MAINBOARD;
    return null;
  };

  public normalizeExchange = (val: any): ExchangeListing | null => {
    if (!val) return null;
    const s = String(val).toUpperCase();
    if (s.includes('BOTH') || (s.includes('NSE') && s.includes('BSE'))) return ExchangeListing.BOTH;
    if (s.includes('NSE')) return ExchangeListing.NSE;
    if (s.includes('BSE')) return ExchangeListing.BSE;
    return null;
  };

  public normalizeIpoStatus = (val: any): IpoStatus | null => {
    if (!val) return null;
    const s = String(val).toUpperCase();
    if (Object.values(IpoStatus).includes(s as any)) return s as IpoStatus;
    return null;
  };

  public normalizeSymbol = (val: any): string | null => {
    if (!val) return null;
    return String(val).trim().toUpperCase();
  };

  public normalizeIsin = (val: any): string | null => {
    if (!val) return null;
    const s = String(val).trim().toUpperCase();
    return /^INE[A-Z0-9]{9}$/.test(s) ? s : null;
  };

  public normalizeRegistrar = (val: any): string | null => {
    if (!val) return null;
    const s = String(val).trim().toUpperCase();
    if (s.includes('LINK') || s.includes('INTIME')) return 'LINK_INTIME';
    if (s.includes('KFIN')) return 'KFINTECH';
    if (s.includes('BIGSHARE')) return 'BIGSHARE';
    if (s.includes('SKYLINE')) return 'SKYLINE';
    if (s.includes('CAMEO')) return 'CAMEO';
    if (s.includes('MAASHITLA')) return 'MAASHITLA';
    if (s.includes('PURVA')) return 'PURVA';
    return this.normalizeString(val);
  };
}
