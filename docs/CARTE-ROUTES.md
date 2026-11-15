# Carte des routes d'Ouvrane

Extraite de `worker/index.js` (4223 lignes, 155 routes). Générée automatiquement, à relire avant tout découpage.

## Où va le travail

| Gestionnaire défini dans | Routes |
|---|---:|
| index.js (à extraire) | 134 |
| personal-followup.js | 3 |
| assignment-assets.js | 2 |
| time-entry-monthly.js | 2 |
| ? | 1 |
| bank-connections.js | 1 |
| contact-files.js | 1 |
| personal-calendar.js | 1 |
| measurements.js | 1 |
| measurement-tasks.js | 1 |
| measurement-procurement.js | 1 |
| plans.js | 1 |
| project-models.js | 1 |
| delivery-scans.js | 1 |
| supplier-price-imports.js | 1 |
| task-stock.js | 1 |
| task-preparations.js | 1 |
| work-packets.js | 1 |

## Les routes, une par une

| Route | Type | Gestionnaire | Défini dans |
|---|---|---|---|
| `/` | exacte | ? | ? |
| `/api/*` | préfixe | json | index.js (à extraire) |
| `/api/*` | préfixe | api | index.js (à extraire) |
| `/api/access-control` | exacte | accessControlRoutes | index.js (à extraire) |
| `/api/access-control/([^` | motif | memberProjectAccessRoute | index.js (à extraire) |
| `/api/access-control/([^` | motif | accessControlRoutes | index.js (à extraire) |
| `/api/accounting/summary` | exacte | accountingSummary | index.js (à extraire) |
| `/api/alerts/respond` | exacte | legacyAlertResponse | index.js (à extraire) |
| `/api/assets` | exacte | fieldAssetsRoute | index.js (à extraire) |
| `/api/assets/([^` | motif | assetAvailabilityRoute | assignment-assets.js |
| `/api/assets/([^` | motif | fieldAssetsRoute | index.js (à extraire) |
| `/api/assets/([^` | motif | fuelRoute | index.js (à extraire) |
| `/api/assets/([^` | motif | assetIssueRoute | index.js (à extraire) |
| `/api/assignments` | exacte | assignmentRoute | index.js (à extraire) |
| `/api/assignments/([^` | motif | assignmentAssetsRoute | assignment-assets.js |
| `/api/assignments/([^` | motif | assignmentRoute | index.js (à extraire) |
| `/api/audit-log` | exacte | auditLogRoutes | index.js (à extraire) |
| `/api/bank/accounts(?:/([^` | motif | bankAccountRoutes | index.js (à extraire) |
| `/api/bank/connections(?:/(institutions|start|complete)|/([^` | motif | bankConnectionsRoute | bank-connections.js |
| `/api/bank/transactions(?:/([^` | motif | bankTransactionsRoute | index.js (à extraire) |
| `/api/bank/transactions/([^` | motif | bankTransactionsRoute | index.js (à extraire) |
| `/api/bank/transactions/([^` | motif | bankTransactionsRoute | index.js (à extraire) |
| `/api/bootstrap` | exacte | json | index.js (à extraire) |
| `/api/commercial-contacts(?:/([^` | motif | json | index.js (à extraire) |
| `/api/commercial-directory` | exacte | json | index.js (à extraire) |
| `/api/commercial-directory/bootstrap` | exacte | json | index.js (à extraire) |
| `/api/contact-files/([^` | motif | contactFilesRoute | contact-files.js |
| `/api/conversations` | exacte | conversationRoutes | index.js (à extraire) |
| `/api/conversations/([^` | motif | personalFollowupRoute | personal-followup.js |
| `/api/customers` | exacte | customerRoutes | index.js (à extraire) |
| `/api/customers/([^` | motif | customerStatusRoute | index.js (à extraire) |
| `/api/customers/([^` | motif | customerRoutes | index.js (à extraire) |
| `/api/document-triage/expense-document` | exacte | documentUploadRoute | index.js (à extraire) |
| `/api/documents` | exacte | documentHistoryRoute | index.js (à extraire) |
| `/api/documents/([^` | motif | json | index.js (à extraire) |
| `/api/documents/([^` | motif | documentHistoryRoute | index.js (à extraire) |
| `/api/documents/([^` | motif | documentContentRoute | index.js (à extraire) |
| `/api/documents/([^` | motif | documentRelationsRoute | index.js (à extraire) |
| `/api/documents/([^` | motif | documentArchiveRoute | index.js (à extraire) |
| `/api/documents/([^` | motif | documentMetadataRoute | index.js (à extraire) |
| `/api/expenses` | exacte | expenseRoutes | index.js (à extraire) |
| `/api/expenses/([^` | motif | supplierPaymentsRoute | index.js (à extraire) |
| `/api/expenses/([^` | motif | supplierPaymentsRoute | index.js (à extraire) |
| `/api/expenses/([^` | motif | supplierAllocationsRoute | index.js (à extraire) |
| `/api/field-data` | exacte | fieldDataRoute | index.js (à extraire) |
| `/api/home-overview` | exacte | homeOverviewRoute | index.js (à extraire) |
| `/api/hr/composition/move` | exacte | hrCompositionRoute | index.js (à extraire) |
| `/api/hr/people` | exacte | hrPeopleRoute | index.js (à extraire) |
| `/api/hr/people/([^` | motif | hrEmploymentRoute | index.js (à extraire) |
| `/api/hr/people/([^` | motif | hrPeopleRoute | index.js (à extraire) |
| `/api/hr/teams` | exacte | hrTeamsRoute | index.js (à extraire) |
| `/api/hr/teams/([^` | motif | hrTeamMembersRoute | index.js (à extraire) |
| `/api/hr/teams/([^` | motif | teamLeadRoute | index.js (à extraire) |
| `/api/hr/teams/([^` | motif | hrTeamsRoute | index.js (à extraire) |
| `/api/invitation-roster` | exacte | invitationRosterRoute | index.js (à extraire) |
| `/api/invitations` | exacte | invitationRoutes | index.js (à extraire) |
| `/api/invitations/([^` | motif | invitationRoutes | index.js (à extraire) |
| `/api/invitations/accept` | exacte | json | index.js (à extraire) |
| `/api/invitations/accept` | exacte | acceptInvitationRoute | index.js (à extraire) |
| `/api/invoices` | exacte | invoicesRoute | index.js (à extraire) |
| `/api/invoices/([^` | motif | invoicePaymentsRoute | index.js (à extraire) |
| `/api/invoices/([^` | motif | invoiceCreditNotesRoute | index.js (à extraire) |
| `/api/invoices/([^` | motif | invoiceDetailRoute | index.js (à extraire) |
| `/api/legacy-upgrade` | exacte | legacyUpgradeRoute | index.js (à extraire) |
| `/api/me/calendar(?:/([^` | motif | personalCalendarRoute | personal-calendar.js |
| `/api/me/follow-up(?:/([^` | motif | personalFollowupRoute | personal-followup.js |
| `/api/me/preferences` | exacte | json | index.js (à extraire) |
| `/api/me/preferences(?:/([^` | motif | json | index.js (à extraire) |
| `/api/measurements(?:/([^` | motif | measurementRoute | measurements.js |
| `/api/measurements/([^` | motif | measurementTasksRoute | measurement-tasks.js |
| `/api/measurements/([^` | motif | measurementProcurementRoute | measurement-procurement.js |
| `/api/members/([^` | motif | memberRoutes | index.js (à extraire) |
| `/api/messages` | exacte | messageRoutes | index.js (à extraire) |
| `/api/messages/([^` | motif | personalFollowupRoute | personal-followup.js |
| `/api/organizations` | exacte | organizationsRoute | index.js (à extraire) |
| `/api/partner-grants` | exacte | partnerGrantRoutes | index.js (à extraire) |
| `/api/partner-grants/([^` | motif | acceptPartnerGrant | index.js (à extraire) |
| `/api/partner-grants/([^` | motif | partnerGrantDetailRoute | index.js (à extraire) |
| `/api/partner-portfolio` | exacte | partnerPortfolio | index.js (à extraire) |
| `/api/partner-requests` | exacte | partnerRequestRoutes | index.js (à extraire) |
| `/api/partner-requests/([^` | motif | partnerRequestDetailRoute | index.js (à extraire) |
| `/api/planning` | exacte | planningRoute | index.js (à extraire) |
| `/api/planning/absences` | exacte | planningAbsenceRoute | index.js (à extraire) |
| `/api/planning/absences/([^` | motif | planningAbsenceRoute | index.js (à extraire) |
| `/api/planning/blocks` | exacte | planningBlockRoute | index.js (à extraire) |
| `/api/planning/blocks/([^` | motif | planningBlockRoute | index.js (à extraire) |
| `/api/planning/replan` | exacte | planningReplanRoute | index.js (à extraire) |
| `/api/plans(?:/([^` | motif | plansRoute | plans.js |
| `/api/project-models(?:/([^` | motif | projectModelsRoute | project-models.js |
| `/api/projects/([^` | motif | planningHistoryRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectMaterialRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectExecutionRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | fieldPhotoUploadRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectNoteRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectNoteRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectProblemRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | stockBarcodeLookupRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | stockConsumeRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | stockConsumeRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | taskRoutes | index.js (à extraire) |
| `/api/projects/([^` | motif | fieldPortalRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectHubRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectTimelineRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectFinancialBaselineRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectFinancialBaselineRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectFinancialForecastRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectCostControlRoute | index.js (à extraire) |
| `/api/projects/([^` | motif | projectRoute | index.js (à extraire) |
| `/api/purchase-orders` | exacte | purchaseOrderRoutes | index.js (à extraire) |
| `/api/purchase-orders/([^` | motif | deliveryScanRoute | delivery-scans.js |
| `/api/purchase-orders/([^` | motif | purchaseOrderConfirmRoute | index.js (à extraire) |
| `/api/purchase-orders/([^` | motif | purchaseOrderCancelRoute | index.js (à extraire) |
| `/api/purchase-orders/([^` | motif | deliveryRoute | index.js (à extraire) |
| `/api/quote-history/([^` | motif | historicalQuoteRoute | index.js (à extraire) |
| `/api/quote-visits` | exacte | quoteVisitRoutes | index.js (à extraire) |
| `/api/quote-visits/*` | préfixe | quoteVisitRoutes | index.js (à extraire) |
| `/api/quotes` | exacte | quoteRoutes | index.js (à extraire) |
| `/api/quotes/([^` | motif | quoteAmendmentRoutes | index.js (à extraire) |
| `/api/quotes/([^` | motif | quoteRoutes | index.js (à extraire) |
| `/api/roles` | exacte | rolesRoute | index.js (à extraire) |
| `/api/search` | exacte | globalSearchRoute | index.js (à extraire) |
| `/api/simulation-runs` | exacte | simulationRunRoutes | index.js (à extraire) |
| `/api/state` | exacte | legacyState | index.js (à extraire) |
| `/api/stock-catalog` | exacte | stockCatalogRoute | index.js (à extraire) |
| `/api/stock-catalog/categories` | exacte | stockCategoryRoute | index.js (à extraire) |
| `/api/stock-catalog/categories/([^` | motif | stockCategoryRoute | index.js (à extraire) |
| `/api/stock-items` | exacte | stockItemRoute | index.js (à extraire) |
| `/api/stock-items/([^` | motif | stockBarcodeManageRoute | index.js (à extraire) |
| `/api/stock-items/([^` | motif | stockMovementRoute | index.js (à extraire) |
| `/api/stock-items/([^` | motif | stockItemRoute | index.js (à extraire) |
| `/api/stock-items/by-barcode` | exacte | stockBarcodeLookupRoute | index.js (à extraire) |
| `/api/stock-locations` | exacte | stockLocationRoutes | index.js (à extraire) |
| `/api/stock-locations/([^` | motif | stockLocationRoutes | index.js (à extraire) |
| `/api/supplier-invoices/([^` | motif | supplierInvoiceMatchesRoute | index.js (à extraire) |
| `/api/supplier-invoices/([^` | motif | supplierInvoiceMatchesRoute | index.js (à extraire) |
| `/api/supplier-price-imports(?:/([^` | motif | supplierPriceImports | supplier-price-imports.js |
| `/api/suppliers` | exacte | supplierRoutes | index.js (à extraire) |
| `/api/suppliers/([^` | motif | supplierRoutes | index.js (à extraire) |
| `/api/tasks` | exacte | taskRoutes | index.js (à extraire) |
| `/api/tasks/([^` | motif | taskStockRoute | task-stock.js |
| `/api/tasks/([^` | motif | taskPreparationsRoute | task-preparations.js |
| `/api/tasks/([^` | motif | taskRoutes | index.js (à extraire) |
| `/api/tasks/([^` | motif | taskRoutes | index.js (à extraire) |
| `/api/tasks/([^` | motif | taskRoutes | index.js (à extraire) |
| `/api/tasks/([^` | motif | taskRoutes | index.js (à extraire) |
| `/api/time-entries` | exacte | timeEntriesList | index.js (à extraire) |
| `/api/time-entries/([^` | motif | timeDepartureRoute | index.js (à extraire) |
| `/api/time-entries/([^` | motif | timeCorrectionRequestRoute | index.js (à extraire) |
| `/api/time-entries/arrival` | exacte | timeArrivalRoute | index.js (à extraire) |
| `/api/time-entries/mine` | exacte | timeEntriesList | index.js (à extraire) |
| `/api/time-entries/monthly` | exacte | timeEntriesMonthlyRoute | time-entry-monthly.js |
| `/api/time-entries/monthly/close` | exacte | timeEntriesMonthlyCloseRoute | time-entry-monthly.js |
| `/api/time-entries/summary` | exacte | timeEntriesSummaryRoute | index.js (à extraire) |
| `/api/time-entry-corrections/([^` | motif | timeCorrectionReviewRoute | index.js (à extraire) |
| `/api/work-packets(?:/([^` | motif | workPacketsRoute | work-packets.js |
