/**
 * Appels du module Partenariats.
 *
 * Un module par domaine, comme les voisins : les pages importent depuis
 * 'lib/api' sans savoir dans quel fichier vit l'appel.
 */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

// ── Dossiers ────────────────────────────────────────────────────────────────

export async function fetchPartnerships(
  params: { stage?: string; type?: string; q?: string } = {},
  guildId = authStore.selectedGuildId,
) {
  const query = new URLSearchParams();
  if (params.stage) query.set('stage', params.stage);
  if (params.type) query.set('type', params.type);
  if (params.q) query.set('q', params.q);
  const suffix = query.toString() ? `?${query}` : '';

  return dashboardRequest(`/partnerships${suffix}`, {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Partnerships):',
  });
}

export async function fetchPartnership(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}`, {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Partnership):',
  });
}

export async function createPartnership(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnerships', {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Create Partnership):',
  });
}

/**
 * Ajout guide : fiche, dossier, engagements, avantages et invitation dediee
 * en un appel, a partir d'un prereglage.
 */
export async function createPartnershipQuick(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnerships/quick', {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Quick Partnership):',
  });
}

export async function updatePartnership(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}`, {
    method: 'PATCH', payload, guildId, silent: true,
    errorContext: 'API Error (Update Partnership):',
  });
}

export async function setPartnershipStage(
  id: string,
  stage: string,
  reason?: string,
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partnerships/${id}/stage`, {
    method: 'POST', payload: { stage, reason }, guildId, silent: true,
    errorContext: 'API Error (Partnership Stage):',
  });
}

export async function approvePartnership(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/approve`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Approve Partnership):',
  });
}

export async function ensurePartnershipInvite(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/invite`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Partnership Invite):',
  });
}

export async function refreshPartnershipHealth(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/health`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Partnership Health):',
  });
}

export async function checkPartnershipReciprocity(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/reciprocity`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Partnership Reciprocity):',
  });
}

export async function refreshPartnershipShowcase(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/showcase`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Partnership Showcase):',
  });
}

// ── Réglages ────────────────────────────────────────────────────────────────

/** Ce qui manque pour que le module serve : salons, role, permissions. */
export async function fetchPartnershipReadiness(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnerships/setup', {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Partnership Readiness):',
  });
}

/** Pose ce qui manque et allume le module. */
export async function runPartnershipSetup(payload: { staffRoleId?: string | null } = {}, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnerships/setup', {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Partnership Setup):',
  });
}

export async function fetchPartnershipSettings(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnerships/settings', {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Partnership Settings):',
  });
}

export async function updatePartnershipSettings(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnerships/settings', {
    method: 'PATCH', payload, guildId, silent: true,
    errorContext: 'API Error (Update Partnership Settings):',
  });
}

export async function fetchPartnershipFinance(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnerships/finance', {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Partnership Finance):',
  });
}

// ── Avantages, engagements, publicités ──────────────────────────────────────

export async function addPartnershipBenefit(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/benefits`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Add Benefit):',
  });
}

export async function removePartnershipBenefit(id: string, benefitId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/benefits/${benefitId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Remove Benefit):',
  });
}

export async function applyPartnershipBenefits(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/benefits/apply`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Apply Benefits):',
  });
}

export async function revokePartnershipBenefits(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/benefits/revoke`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Revoke Benefits):',
  });
}

export async function addPartnershipCommitment(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/commitments`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Add Commitment):',
  });
}

export async function setCommitmentState(
  id: string,
  commitmentId: string,
  payload: { state: string | null; note?: string },
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partnerships/${id}/commitments/${commitmentId}`, {
    method: 'PATCH', payload, guildId, silent: true,
    errorContext: 'API Error (Commitment State):',
  });
}

export async function removeCommitment(id: string, commitmentId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/commitments/${commitmentId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Remove Commitment):',
  });
}

export async function savePartnershipPromotion(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/promotions`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Save Promotion):',
  });
}

export async function publishPartnershipPromotion(
  id: string,
  promotionId: string,
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partnerships/${id}/promotions/${promotionId}/publish`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Publish Promotion):',
  });
}

export async function deletePartnershipPromotion(
  id: string,
  promotionId: string,
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partnerships/${id}/promotions/${promotionId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Delete Promotion):',
  });
}

// ── Accords, portail invité, finance ────────────────────────────────────────

export async function draftPartnershipAgreement(id: string, body: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/agreements`, {
    method: 'POST', payload: { body }, guildId, silent: true,
    errorContext: 'API Error (Draft Agreement):',
  });
}

export async function agreementAction(
  id: string,
  agreementId: string,
  action: 'propose' | 'accept' | 'withdraw',
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partnerships/${id}/agreements/${agreementId}/${action}`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Agreement Action):',
  });
}

export async function createGuestAccess(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/guest-access`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Guest Access):',
  });
}

export async function revokeGuestAccess(id: string, accessId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/guest-access/${accessId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Revoke Guest Access):',
  });
}

export async function addPartnershipPayment(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/payments`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Add Payment):',
  });
}

export async function settlePartnershipPayment(
  id: string,
  paymentId: string,
  payload: unknown,
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partnerships/${id}/payments/${paymentId}/settle`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Settle Payment):',
  });
}

export async function deletePartnershipPayment(id: string, paymentId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/payments/${paymentId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Delete Payment):',
  });
}

// ── Notes et documents ──────────────────────────────────────────────────────

export async function addPartnershipNote(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/notes`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Add Note):',
  });
}

export async function deletePartnershipNote(id: string, noteId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/notes/${noteId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Delete Note):',
  });
}

export async function addPartnershipDocument(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/documents`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Add Document):',
  });
}

export async function deletePartnershipDocument(id: string, documentId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnerships/${id}/documents/${documentId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Delete Document):',
  });
}

// ── Fiches partenaires ──────────────────────────────────────────────────────

export async function fetchPartners(q = '', guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partners${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Partners):',
  });
}

/**
 * Ce que Discord dit d'une invitation : nom du serveur, presentation, icone,
 * banniere, effectif. Rien n'est enregistre, le formulaire propose le resultat.
 */
export async function lookupPartnerInvite(invite: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partners/lookup-invite', {
    method: 'POST', payload: { invite }, guildId, silent: true,
    errorContext: 'API Error (Lookup Invite):',
  });
}

export async function createPartner(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partners', {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Create Partner):',
  });
}

export async function updatePartner(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partners/${id}`, {
    method: 'PATCH', payload, guildId, silent: true,
    errorContext: 'API Error (Update Partner):',
  });
}

export async function deletePartner(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partners/${id}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Delete Partner):',
  });
}

export async function addPartnerContact(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partners/${id}/contacts`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Add Contact):',
  });
}

export async function updatePartnerContact(
  id: string,
  contactId: string,
  payload: unknown,
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partners/${id}/contacts/${contactId}`, {
    method: 'PATCH', payload, guildId, silent: true,
    errorContext: 'API Error (Update Contact):',
  });
}

export async function removePartnerContact(id: string, contactId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partners/${id}/contacts/${contactId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Remove Contact):',
  });
}

export async function setPartnerBlocked(
  id: string,
  payload: { blocked: boolean; reason?: string },
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partners/${id}/block`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Block Partner):',
  });
}

export async function checkPartnerInvite(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partners/${id}/invite-check`, {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Check Invite):',
  });
}

export async function reportPartner(id: string, payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partners/${id}/report`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Report Partner):',
  });
}

export async function fetchPartnerReputation(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partners/${id}/reputation`, {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Partner Reputation):',
  });
}

// ── Candidatures ────────────────────────────────────────────────────────────

export async function fetchPartnerApplications(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partner-applications', {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Partner Applications):',
  });
}

export async function createPartnerApplication(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partner-applications', {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Create Application):',
  });
}

export async function decidePartnerApplication(
  id: string,
  payload: { status: string; reason?: string },
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partner-applications/${id}/decision`, {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Decide Application):',
  });
}

// ── Annuaire ────────────────────────────────────────────────────────────────

export async function fetchPartnershipDirectory(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnership-directory', {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Directory):',
  });
}

export async function savePartnershipListing(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnership-directory/listing', {
    method: 'PUT', payload, guildId, silent: true,
    errorContext: 'API Error (Save Listing):',
  });
}

/** Fiche pre-remplie a partir du serveur Discord lui-meme. */
export async function suggestPartnershipListing(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnership-directory/suggest', {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Listing Suggestion):',
  });
}

/** Cree, ou retrouve, l'invitation permanente publiee sur la vitrine. */
export async function createShowcaseInvite(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnership-directory/invite', {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Showcase Invite):',
  });
}

export async function searchPartnershipDirectory(
  params: { q?: string; tags?: string; locale?: string; size?: string; type?: string } = {},
  guildId = authStore.selectedGuildId,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query}` : '';

  return dashboardRequest(`/partnership-directory/search${suffix}`, {
    method: 'GET', guildId, silent: true,
    errorContext: 'API Error (Search Directory):',
  });
}

export async function computePartnershipMatches(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnership-directory/matches', {
    method: 'POST', guildId, silent: true,
    errorContext: 'API Error (Compute Matches):',
  });
}

export async function dismissPartnershipMatch(suggestedGuildId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnership-directory/matches/${suggestedGuildId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Dismiss Match):',
  });
}

export async function sendPartnershipProposal(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnership-directory/proposals', {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Send Proposal):',
  });
}

export async function respondToPartnershipProposal(
  proposalId: string,
  action: 'accept' | 'decline' | 'withdraw',
  note?: string,
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest(`/partnership-directory/proposals/${proposalId}/${action}`, {
    method: 'POST', payload: { note }, guildId, silent: true,
    errorContext: 'API Error (Proposal Response):',
  });
}

export async function blockPartnerSubject(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/partnership-directory/blocklist', {
    method: 'POST', payload, guildId, silent: true,
    errorContext: 'API Error (Block Subject):',
  });
}

export async function unblockPartnerSubject(entryId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnership-directory/blocklist/${entryId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Unblock Subject):',
  });
}

export async function withdrawPartnerReport(reportId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/partnership-directory/reports/${reportId}`, {
    method: 'DELETE', guildId, silent: true,
    errorContext: 'API Error (Withdraw Report):',
  });
}
