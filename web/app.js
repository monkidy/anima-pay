// ANIMA screen, in French or English. Everything shown comes from /api/state. Receipts are
// recorded in English; the screen translates them from their codes and parameters. Untrusted
// text (invoices, a real model's reasons) is always inserted as text, never as HTML.
"use strict";

const I18N = {
  en: {
    slogan: "Agents can spend. Make them bring receipts.", catchphrase: "No receipt, no payment.",
    mandate_title: "The mandate", mandate_hint: "What the assistant may spend. Written by a person, never by the model.",
    purpose: "Purpose", payees: "Payees", per_payment: "Per payment", up_to: "up to {x}", per_days: "Per {d} days",
    releases: "Person releases", releases_v: "above {x}, or on any doubt", expires: "Expires",
    scenes_title: "Seven scenes", scene: "SCENE {n}", reset: "Start over",
    waiting_title: "Waiting for you", waiting_empty: "Nothing waiting. Run a scene.",
    receipts_title: "Receipts", receipts_hint: "Every outcome leaves one, including the payments that did not happen. Corrections are added beside, never over.",
    badge_real: "PayPal sandbox", badge_sim: "Simulated sandbox (no PayPal credentials yet)", advisor: "Advisor: {m}",
    scene_head: "Scene {n}: {t}", model_said: "The model said: ", read_to: "{r} — read {a} to {m}", nothing: "nothing usable",
    outcome: "Outcome: ", refused_before: "Refused before PayPal: {x}", passed: "Passed the mandate. Waiting below for the payer and, if needed, for you.",
    invoice_text: "Invoice text the model read (untrusted)", model_line: "Model: {r}. {why}", have_read: "I have read: {m}",
    approve_sim: "Approve as the payer (simulated PayPal)", approve_real: "Approve on PayPal", approved_sim: "✓ Payer approved on PayPal (simulated)",
    pp_checking: "PayPal: checking…", pp_live: "PayPal says: {s}", pp_ok: "✓ PayPal confirms the payer approved", pp_unreachable: "PayPal could not be reached: {e}",
    test_payer: "Test payer (PayPal sandbox test card)", pp_card: "✓ PayPal authorized its sandbox test card, standing in for the payer",
    release: "Release the payment", capture: "Capture", decline: "Decline", not_done: "Not done",
    col_time: "Time", col_verdict: "Verdict", col_status: "Status", col_moved: "Money moved", col_req: "Requested", col_paypal: "PayPal evidence",
    col_approval: "Approval", col_seams: "Golden seams", no_rows: "No receipts yet.", yes: "yes", no: "no", no_call: "no call made",
    asked_ran: "What was asked, what ran", requested: "Requested", done: "Actually done", started: "Execution started", moved: "Money moved",
    approval: "Approval", advisor_row: "Advisor", type: "Receipt type", explanation: "Explanation", seam: "Golden seam", add_seam: "Add the correction (golden seam)",
    boundary: "Boundary", mandate: "Mandate", proposal: "Proposal", idem: "Idempotency key", findings: "Findings", none: "None.",
    evidence: "PayPal evidence", no_evidence: "No PayPal call was made.", untranslated: "",
    trust_title: "Earned trust", trust_hint: "Autonomy is earned by receipts: granted only by a person, lost at the first anomaly.",
    trust_none: "No autonomy yet: every payment waits for a person.", trust_level: "Pays alone up to {x}", trust_streak: "{n} of {k} clean payments toward the next step",
    trust_seal: "Seal the step: pay alone up to {x}", trust_anomaly: "Last anomaly: {r}", trust_ceiling: "ceiling {x}",
    th_invoice: "The invoice, as it arrived", th_locks: "Three locks", lock_mandate: "Your mandate", lock_payer: "The payer, on PayPal", lock_person: "Your seal",
    lock_open: "open", lock_closed: "closed", lock_unasked: "not asked", lock_shut: "shut", lock_na: "not needed", th_scene: "Scene {n}",
    council: "The council", proposer: "Proposer", adversary: "Adversary", verifier: "Verifier", stance_OBJECT: "objects", stance_NO_OBJECTION: "no objection",
    dissent_note: "The council disagreed. Nothing is paid without a person, and the dissent stays in the receipt.",
    tools_head: "The agent's call to PayPal's tools", tool_release: "Release the call", tool_read_from: "Read from PayPal: {x}", tool_nothing_read: "nothing could be read from PayPal",
    tool_recipients: "reaches {x}", tool_reason: "The agent's reason: {r}", tool_hint: "The agent asked; ANIMA decided before PayPal heard anything.", tool_skipped: "Left out: {x}",
    class_read: "read", class_money: "money", class_outreach: "reaches a customer", class_destructive: "deletes or cancels", class_setup: "records", class_null: "unknown tool",
    step_read: "passed (a read)", step_held: "held for a person", step_refused: "refused", step_done: "ran at PayPal", step_error: "error",
    no_call_tool: "PayPal not asked", tool_call: "The call", tool_tool: "Tool", tool_class: "Class", tool_args: "Arguments", tool_agent: "Agent", tool_released_by: "Released by",
    tool_result: "PayPal's answer", tool_facts: "Facts read from PayPal", tool_ran: "Ran at PayPal",
    tool_read_ok: "PayPal answered ({x}).", tool_read_err: "PayPal answered with an error: {x}",
    eyebrow: "A gate between AI agents and PayPal", q1: "An AI wants to pay. ", q2: "ANIMA can say no", q3: ".",
    lede: "An invoice can fool the model. ANIMA checks the amount, the mandate and human approval before capture. Even a refused payment leaves a signed receipt.",
    cta_run: "See a guarded payment", cta_poison: "Test the poisoned invoice",
    next_step: "WHAT IF THE BILL IS LEGITIMATE?", next_clean_title: "Stopping a mistake is only half the story.",
    next_clean_text: "Now watch an ordinary invoice: the payer and human-release checks still matter.",
    next_clean_cta: "Compare with a legitimate payment",
    chain_agent: "Agent proposes", chain_mandate: "Your mandate", chain_payer: "Payer on PayPal", chain_seal: "Your seal", chain_receipt: "Signed receipt",
    mandate_kind: "Spend mandate", mandate_signed: "Signed by the account holder · never by the model",
    scenes_hint: "Seven short cases. Each proves one thing, on PayPal's sandbox.",
    status_real: "PayPal sandbox", status_real_v: "real API, test money", status_sim: "Simulated sandbox", status_sim_v: "no PayPal credentials",
    status_tools_sim: "PayPal's tools: simulated", status_tools_sim_v: "PayPal's tool server failed at {time} UTC",
    fw_fallback: "PayPal's tool server failed at {time} UTC, before sending {tool} to PayPal's payments API ({code}: {message}). Since then this scene goes on with the simulated PayPal tools: ANIMA's locks are the same, and each row says whose tools answered.",
    sim_tag: "simulated", moved_sim: "simulated only", tool_not_sent_v: "no: PayPal's tool server failed before sending it",
    status_last: "Last receipt {t} UTC · #{i}", status_none: "No receipt yet", forensic: "Forensic ledger", receipts_n: "{n} sealed",
    proof_heading: "Follow the evidence", proof_hint: "Every result is inspectable. These are ledger counts, not an AI accuracy score.",
    proof_all: "All outcomes", proof_moved: "Money moved", proof_not_moved: "No money moved", proof_corrected: "Corrected",
    proof_total: "Outcomes recorded", proof_yes: "Money moved", proof_no: "No money moved", proof_fixes: "Corrected",
    proof_search: "Search by receipt, payee or PayPal reference", proof_search_hint: "Search the evidence…",
    proof_shown: "{n} of {total} outcomes shown",
    proof_footnote: "No money moved does not mean PayPal was never contacted: refusals, holds and incomplete captures remain distinct. Click a row for its original receipt and provider evidence.",
    rail_propose: "Propose", rail_challenge: "Challenge", rail_verify: "Verify", rail_mandate: "Mandate", rail_gate: "Gate", rail_payer: "Payer", rail_seal: "Seal", rail_receipt: "Receipt",
    receipt_kind: "Receipt", tool_kind: "Tool call", proof_empty: "No receipt yet. Run a decision: every outcome, paid or not, leaves one here.",
    ev_paypal: "PayPal", ev_approval: "Approval", ev_moved: "Money moved", seal_chain: "chain", seal_hash: "hash", seal_sig: "Ed25519", seal_key: "key",
    sealed_below: "The receipt is sealed in the chain (#{i}), below.", stamp_sealed: "SEALED", stamp_refused: "REFUSED", ladder_0: "every payment waits", ladder_n: "alone ≤ {x}", open_receipt: "Open the receipt",
    approvalv: { payer_on_paypal: "payer on PayPal", payer_and_human_release: "payer + human release", sandbox_test_card: "PayPal test card", sandbox_test_card_and_human_release: "PayPal test card + human release", human_release: "human release", none: "none" },
    rtype: { ACTION_RECEIPT: "action receipt", REFUSAL_RECEIPT: "refusal receipt", BLOCKED_ACTION_RECEIPT: "blocked action receipt", PARTIAL_ACTION_RECEIPT: "partial receipt" },
    status: { COMPLETED: "done", REFUSED: "refused", NOT_AUTHORIZED: "not authorized", BLOCKED: "blocked", PARTIAL: "not finished", DENIED: "denied by a rule", FAILED: "failed" },
    tool_read_from_sim: "Read from the simulated PayPal: {x}", tool_read_ok_sim: "The simulated PayPal answered ({x}).", tool_read_err_sim: "The simulated PayPal answered with an error: {x}",
    tool_facts_sim: "Facts read from the simulated PayPal", tool_result_sim: "The simulated PayPal's answer", tool_ran_sim: "Ran at the simulated PayPal",
    fw_read_sim: "Read at the simulated PayPal", fw_done_sim: "Ran at the simulated PayPal", fw_paypal_refused_sim: "Sent; the simulated PayPal refused it", fw_unknown_sim: "Sent; the simulated PayPal did not answer",
    fw_sum_read_sim: "{n} reached the simulated PayPal", fw_col_paypal_sim: "PayPal (simulated)", step_paypal_refused_sim: "released, refused by the simulated PayPal", step_unknown_sim: "released, no answer from the simulated PayPal",
    fw_read_failed_sim: "Sent; the simulated PayPal's tools answered with an error", fw_tools_failed_sim: "Sent; the simulated PayPal's tool server failed before its payments API", step_tools_failed_sim: "released, failed in the simulated PayPal's tool server", step_done_sim: "ran at the simulated PayPal",
    trust_reset: "autonomy reset", trust_alone: "the agent may pay alone, per payment", trust_record: "Its record", trust_no_record: "no payment yet",
    fw_read: "Read at PayPal", fw_done: "Ran at PayPal", fw_held: "Not sent: waits for a person", fw_never: "Never sent to PayPal", fw_error: "Error",
    fw_sum_read: "{n} reached PayPal", fw_sum_held: "{n} held", fw_sum_refused: "{n} refused", fw_sum_unclear: "{n} without a clear answer",
    fw_paypal_refused: "Sent; PayPal refused it", fw_unknown: "Sent; PayPal did not answer",
    fw_read_failed: "Sent; PayPal's tools answered with an error", fw_tools_failed: "Sent; PayPal's tool server failed before PayPal's payments API",
    step_read_failed: "passed (a read)", step_tools_failed: "released, failed in PayPal's tool server",
    step_paypal_refused: "released, refused by PayPal", step_unknown: "released, no answer from PayPal", fw_col_agent: "The agent asks", fw_col_anima: "ANIMA decides", fw_col_paypal: "PayPal",
    // The badge names what ANIMA did, not how the run went: a refused payment is the gate working, never a "fail".
    verdict: { pass: "pass", hold: "hold", fail: "refused" },
  },
  fr: {
    slogan: "Les agents peuvent dépenser. Qu'ils apportent les reçus.", catchphrase: "Pas de reçu, pas de paiement.",
    mandate_title: "Le mandat", mandate_hint: "Ce que l'assistant a le droit de dépenser. Écrit par une personne, jamais par l'IA.",
    purpose: "Objet", payees: "Bénéficiaires", per_payment: "Par paiement", up_to: "jusqu'à {x}", per_days: "Sur {d} jours",
    releases: "Déblocage humain", releases_v: "au-dessus de {x}, ou au moindre doute", expires: "Expire le",
    scenes_title: "Sept scènes", scene: "SCÈNE {n}", reset: "Tout recommencer",
    waiting_title: "En attente de toi", waiting_empty: "Rien en attente. Lance une scène.",
    receipts_title: "Reçus", receipts_hint: "Chaque issue en laisse un, y compris les paiements qui n'ont pas eu lieu. Les corrections s'ajoutent à côté, jamais par-dessus.",
    badge_real: "Bac à sable PayPal", badge_sim: "Bac à sable simulé (pas encore d'identifiants PayPal)", advisor: "Conseiller IA : {m}",
    scene_head: "Scène {n} : {t}", model_said: "L'IA a dit : ", read_to: "{r} — elle a lu {a} pour {m}", nothing: "rien d'exploitable",
    outcome: "Résultat : ", refused_before: "Refusé avant PayPal : {x}", passed: "Le mandat est respecté. En attente ci-dessous du payeur et, si besoin, de toi.",
    invoice_text: "Texte de la facture lu par l'IA (non fiable, laissé en anglais)", model_line: "IA : {r}. {why}", have_read: "J'ai lu : {m}",
    approve_sim: "Approuver comme payeur (PayPal simulé)", approve_real: "Approuver sur PayPal", approved_sim: "✓ Le payeur a approuvé sur PayPal (simulé)",
    pp_checking: "PayPal : vérification…", pp_live: "PayPal dit : {s}", pp_ok: "✓ PayPal confirme que le payeur a approuvé", pp_unreachable: "PayPal injoignable : {e}",
    test_payer: "Payeur de test (carte de test PayPal, bac à sable)", pp_card: "✓ PayPal a autorisé sa carte de test, à la place du payeur (bac à sable)",
    release: "Débloquer le paiement", capture: "Encaisser", decline: "Refuser", not_done: "Pas fait",
    col_time: "Heure", col_verdict: "Verdict", col_status: "Statut", col_moved: "Argent parti", col_req: "Demandé", col_paypal: "Preuve PayPal",
    col_approval: "Approbation", col_seams: "Coutures d'or", no_rows: "Aucun reçu pour l'instant.", yes: "oui", no: "non", no_call: "aucun appel",
    asked_ran: "Ce qui était demandé, ce qui s'est passé", requested: "Demandé", done: "Réellement fait", started: "Exécution commencée", moved: "Argent parti",
    approval: "Approbation", advisor_row: "Conseiller IA", type: "Type de reçu", explanation: "Explication", seam: "Couture d'or", add_seam: "Ajouter la correction (couture d'or)",
    boundary: "Cadre", mandate: "Mandat", proposal: "Proposition", idem: "Clé anti-doublon", findings: "Constats", none: "Aucun.",
    evidence: "Preuve PayPal", no_evidence: "Aucun appel à PayPal n'a été fait.", untranslated: " (réponse de l'IA, non traduite)",
    trust_title: "La confiance gagnée", trust_hint: "L'autonomie se gagne par les reçus : accordée seulement par une personne, perdue à la première anomalie.",
    trust_none: "Aucune autonomie pour l'instant : chaque paiement attend une personne.", trust_level: "Paie seul jusqu'à {x}", trust_streak: "{n} sur {k} paiements propres vers la prochaine étape",
    trust_seal: "Sceller l'étape : payer seul jusqu'à {x}", trust_anomaly: "Dernière anomalie : {r}", trust_ceiling: "plafond {x}",
    th_invoice: "La facture, telle qu'elle est arrivée", th_locks: "Trois verrous", lock_mandate: "Ton mandat", lock_payer: "Le payeur, sur PayPal", lock_person: "Ton sceau",
    lock_open: "ouvert", lock_closed: "fermé", lock_unasked: "non sollicité", lock_shut: "verrouillé", lock_na: "pas nécessaire", th_scene: "Scène {n}",
    council: "Le conseil", proposer: "Celle qui propose", adversary: "Celle qui conteste", verifier: "Celle qui vérifie", stance_OBJECT: "conteste", stance_NO_OBJECTION: "pas d'objection",
    dissent_note: "Le conseil n'est pas d'accord. Rien n'est payé sans une personne, et le désaccord reste écrit dans le reçu.",
    tools_head: "L'appel de l'agent aux outils de PayPal", tool_release: "Débloquer l'appel", tool_read_from: "Lu chez PayPal : {x}", tool_nothing_read: "rien n'a pu être lu chez PayPal",
    tool_recipients: "atteint {x}", tool_reason: "Raison donnée par l'agent : {r}", tool_hint: "L'agent a demandé ; ANIMA a décidé avant que PayPal n'entende quoi que ce soit.", tool_skipped: "Laissé de côté : {x}",
    class_read: "lecture", class_money: "argent", class_outreach: "atteint un client", class_destructive: "supprime ou annule", class_setup: "écriture", class_null: "outil inconnu",
    step_read: "passe (une lecture)", step_held: "retenu pour une personne", step_refused: "refusé", step_done: "exécuté chez PayPal", step_error: "erreur",
    no_call_tool: "PayPal non sollicité", tool_call: "L'appel", tool_tool: "Outil", tool_class: "Classe", tool_args: "Arguments", tool_agent: "Agent", tool_released_by: "Débloqué par",
    tool_result: "Réponse de PayPal", tool_facts: "Faits lus chez PayPal", tool_ran: "Exécuté chez PayPal",
    tool_read_ok: "PayPal a répondu ({x}).", tool_read_err: "PayPal a répondu par une erreur : {x}",
    eyebrow: "Une porte entre les agents IA et PayPal", q1: "L'IA veut payer. ", q2: "ANIMA peut dire non", q3: ".",
    lede: "Une facture peut tromper le modèle. ANIMA vérifie le montant, le mandat et l'accord humain avant l'encaissement. Même un paiement refusé laisse un reçu signé.",
    cta_run: "Voir un paiement encadré", cta_poison: "Tester la facture piégée",
    next_step: "ET SI LA FACTURE EST LÉGITIME ?", next_clean_title: "Arrêter une erreur n'est que la moitié de l'histoire.",
    next_clean_text: "Compare maintenant avec une facture ordinaire : l'accord du payeur et les autorisations humaines comptent toujours.",
    next_clean_cta: "Comparer avec un paiement légitime",
    chain_agent: "L'agent propose", chain_mandate: "Ton mandat", chain_payer: "Payeur sur PayPal", chain_seal: "Ton sceau", chain_receipt: "Reçu signé",
    mandate_kind: "Mandat de dépense", mandate_signed: "Signé par le titulaire · jamais par l'IA",
    scenes_hint: "Sept cas courts. Chacun prouve une chose, dans le bac à sable de PayPal.",
    status_real: "Bac à sable PayPal", status_real_v: "vraie API, argent fictif", status_sim: "Bac à sable simulé", status_sim_v: "pas d'identifiants PayPal",
    status_tools_sim: "Outils PayPal : simulés", status_tools_sim_v: "le serveur d'outils de PayPal a échoué à {time} UTC",
    fw_fallback: "Le serveur d'outils de PayPal a échoué à {time} UTC, avant d'envoyer {tool} à l'API de paiement de PayPal ({code} : {message}). Depuis, cette scène continue avec les outils PayPal simulés : les verrous d'ANIMA sont les mêmes, et chaque ligne dit quels outils ont répondu.",
    sim_tag: "simulé", moved_sim: "simulé seulement", tool_not_sent_v: "non : le serveur d'outils de PayPal a échoué avant de l'envoyer",
    status_last: "Dernier reçu {t} UTC · n° {i}", status_none: "Aucun reçu pour l'instant", forensic: "Registre détaillé", receipts_n: "{n} scellés",
    proof_heading: "Remonter jusqu'à la preuve", proof_hint: "Chaque résultat se vérifie. Ce sont des comptes du registre, pas un score de précision de l'IA.",
    proof_all: "Toutes les issues", proof_moved: "Argent parti", proof_not_moved: "Aucun argent parti", proof_corrected: "Corrigées",
    proof_total: "Issues enregistrées", proof_yes: "Argent parti", proof_no: "Aucun argent parti", proof_fixes: "Corrigées",
    proof_search: "Chercher par reçu, bénéficiaire ou référence PayPal", proof_search_hint: "Chercher une preuve…",
    proof_shown: "{n} issues affichées sur {total}",
    proof_footnote: "Aucun argent parti ne signifie pas forcément que PayPal n'a pas été contacté : refus, attentes et encaissements incomplets restent distincts. Ouvre une ligne pour consulter son reçu et sa preuve fournisseur.",
    rail_propose: "Proposer", rail_challenge: "Contester", rail_verify: "Vérifier", rail_mandate: "Mandat", rail_gate: "Porte", rail_payer: "Payeur", rail_seal: "Sceau", rail_receipt: "Reçu",
    receipt_kind: "Reçu", tool_kind: "Appel d'outil", proof_empty: "Aucun reçu pour l'instant. Lance une décision : chaque issue, payée ou non, en laisse un ici.",
    ev_paypal: "PayPal", ev_approval: "Approbation", ev_moved: "Argent parti", seal_chain: "chaîne", seal_hash: "empreinte", seal_sig: "Ed25519", seal_key: "clé",
    sealed_below: "Le reçu est scellé dans la chaîne (n° {i}), ci-dessous.", stamp_sealed: "SCELLÉ", stamp_refused: "REFUSÉ", ladder_0: "chaque paiement attend", ladder_n: "seul ≤ {x}", open_receipt: "Ouvrir le reçu",
    tool_read_from_sim: "Lu chez le PayPal simulé : {x}", tool_read_ok_sim: "Le PayPal simulé a répondu ({x}).", tool_read_err_sim: "Le PayPal simulé a répondu par une erreur : {x}",
    tool_facts_sim: "Faits lus chez le PayPal simulé", tool_result_sim: "Réponse du PayPal simulé", tool_ran_sim: "Exécuté chez le PayPal simulé",
    fw_read_sim: "Lu chez le PayPal simulé", fw_done_sim: "Exécuté chez le PayPal simulé", fw_paypal_refused_sim: "Envoyé ; le PayPal simulé l'a refusé", fw_unknown_sim: "Envoyé ; le PayPal simulé n'a pas répondu",
    fw_sum_read_sim: "{n} arrivé{s} chez le PayPal simulé", fw_col_paypal_sim: "PayPal (simulé)", step_paypal_refused_sim: "débloqué, refusé par le PayPal simulé", step_unknown_sim: "débloqué, sans réponse du PayPal simulé",
    fw_read_failed_sim: "Envoyé ; les outils du PayPal simulé ont répondu par une erreur", fw_tools_failed_sim: "Envoyé ; le serveur d'outils du PayPal simulé a échoué avant son API de paiement", step_tools_failed_sim: "débloqué, échec dans le serveur d'outils du PayPal simulé", step_done_sim: "exécuté chez le PayPal simulé",
    trust_reset: "autonomie remise à zéro", trust_alone: "l'agent peut payer seul, par paiement", trust_record: "Son historique", trust_no_record: "aucun paiement pour l'instant",
    fw_read: "Lu chez PayPal", fw_done: "Exécuté chez PayPal", fw_held: "Pas envoyé : attend une personne", fw_never: "Jamais envoyé à PayPal", fw_error: "Erreur",
    fw_sum_read: "{n} arrivé{s} chez PayPal", fw_sum_held: "{n} retenu{s}", fw_sum_refused: "{n} refusé{s}", fw_sum_unclear: "{n} sans réponse claire",
    fw_paypal_refused: "Envoyé ; PayPal l'a refusé", fw_unknown: "Envoyé ; PayPal n'a pas répondu",
    fw_read_failed: "Envoyé ; les outils de PayPal ont répondu par une erreur", fw_tools_failed: "Envoyé ; le serveur d'outils de PayPal a échoué avant l'API de paiement de PayPal",
    step_read_failed: "passe (une lecture)", step_tools_failed: "débloqué, échec dans le serveur d'outils de PayPal",
    step_paypal_refused: "débloqué, refusé par PayPal", step_unknown: "débloqué, sans réponse de PayPal", fw_col_agent: "L'agent demande", fw_col_anima: "ANIMA décide", fw_col_paypal: "PayPal",
    anomaly: { CORRECTED: "correction (couture d'or)", DECLINED_BY_HUMAN: "refus par une personne", POSSIBLE_DUPLICATE: "doublon possible", PROPOSAL_DOES_NOT_MATCH_INVOICE: "proposition différente de la facture", MODEL_ADVISES_WAIT: "l'IA conseille d'attendre", MODEL_ADVISES_REFUSE: "l'IA conseille de refuser", INVOICE_ALREADY_PAID: "facture déjà payée" },
    verdict: { pass: "passe", hold: "retenu", fail: "refusé" },
    phrase: { pass: "La preuve ouvre la porte.", hold: "Pas encore. Apporte les reçus.", fail: "Les impressions ne passent pas." },
    rec: { PAY: "PAYER", WAIT: "ATTENDRE", REFUSE: "REFUSER" },
    status: { COMPLETED: "fait", REFUSED: "refusé", NOT_AUTHORIZED: "non autorisé", BLOCKED: "bloqué", PARTIAL: "non terminé", DENIED: "refusé par une règle", FAILED: "échoué" },
    approvalv: { payer_on_paypal: "payeur sur PayPal", payer_and_human_release: "payeur + déblocage humain", sandbox_test_card: "carte de test PayPal", sandbox_test_card_and_human_release: "carte de test PayPal + déblocage humain", human_release: "déblocage humain", none: "aucune" },
    rtype: { ACTION_RECEIPT: "reçu d'action", REFUSAL_RECEIPT: "reçu de refus", BLOCKED_ACTION_RECEIPT: "reçu d'action bloquée", PARTIAL_ACTION_RECEIPT: "reçu partiel" },
    request: "payer {a} à {m} pour la facture {n}",
    scripted: "réponses écrites d'avance (aucun modèle branché)",
    scripted_unavailable: "réponses écrites d'avance (modèle en direct indisponible : {w})",
    scripted_budget: "réponses écrites d'avance (quota du jour du modèle en direct épuisé)",
    finding: {
      MANDATE_REVOKED: "Le mandat a été révoqué par son titulaire.",
      MANDATE_EXPIRED: "Le mandat a expiré le {date}.",
      CURRENCY_NOT_IN_MANDATE: "Le mandat couvre {mandate}, la facture est en {invoice}.",
      MERCHANT_NOT_IN_MANDATE: "{merchant} n'est pas un bénéficiaire autorisé par ce mandat.",
      PROPOSAL_DOES_NOT_MATCH_INVOICE: "L'IA a proposé un bénéficiaire, un montant ou une devise différents de la facture enregistrée.",
      OVER_PER_PAYMENT_LIMIT: "Le montant dépasse la limite par paiement.",
      OVER_PERIOD_BUDGET: "Payer ferait dépasser le budget du mandat sur {days} jours.",
      INVOICE_ALREADY_PAID: "La facture {number} de {merchant} a déjà été payée.",
      POSSIBLE_DUPLICATE: "Même bénéficiaire et même montant déjà payés sur la période.",
      MODEL_ADVISES_WAIT: "L'IA conseille d'attendre : {reasons}",
      MODEL_ADVISES_REFUSE: "L'IA conseille de ne pas payer : {reasons}",
      HUMAN_RELEASE_REQUIRED: "Une personne doit débloquer ce paiement avant l'encaissement.",
      TOOL_RELEASE_REQUIRED: "Une personne doit débloquer cet appel avant qu'il ne parte chez PayPal.",
      DOUBLE_CAPTURE: "Un encaissement existe déjà pour ce paiement.",
      PAYER_NOT_APPROVED: "Aucune approbation du payeur sur PayPal.",
      HUMAN_RELEASE_MISSING: "En attente du déblocage par une personne.",
      DECLINED_BY_HUMAN: "Refusé : {message}",
      COUNCIL_DISSENT: "Le conseil n'est pas d'accord ; chaque voix est écrite dans le reçu.",
      DOCUMENT_FORM_NOT_EARNED: "Le texte de cette facture diffère de ceux sur lesquels cette autonomie a été gagnée, au-delà de son numéro, de sa date et de son montant. Une personne doit le lire.",
      TOOL_NOT_CLASSIFIED: "{tool} n'est pas un outil connu du pare-feu ; un outil inconnu est refusé.",
      TOOL_CLASS_NOT_IN_MANDATE: "Le mandat n'autorise pas les outils de ce type ({tool}).",
      AMOUNT_UNKNOWN: "Le montant en jeu n'a pas pu être lu chez PayPal ; une personne doit décider.",
      OVER_PER_CALL_LIMIT: "{amount} dépasse les {limit} autorisés par appel.",
      RECIPIENT_NOT_IN_MANDATE: "{recipients} ne fait pas partie des personnes que l'agent peut contacter.",
      RECIPIENTS_UNKNOWN: "Les destinataires n'ont pas pu être lus chez PayPal ; une personne doit décider.",
      DESTRUCTIVE_ACTION: "{tool} supprime ou annule quelque chose ; une personne doit le débloquer.",
      REPEATED_CALL: "{tool} a déjà été exécuté sur le même objet ; une seconde fois demande une personne.",
      PAYPAL_REFUSED: "PayPal a refusé l'appel.", PAYPAL_REFUSED_SIM: "Le PayPal simulé a refusé l'appel.",
      PAYPAL_TOOLS_NOT_SENT: "Le serveur d'outils de PayPal a échoué avant d'envoyer l'appel à l'API de paiement de PayPal.",
      OUTCOME_UNKNOWN: "PayPal n'a pas répondu ; on ne sait pas si l'appel a été exécuté.",
      ALREADY_RAN: "PayPal a déjà exécuté cet appel.",
      ALREADY_PAID_AT_PAYPAL: "PayPal a refusé un second paiement pour la facture {invoice}.",
      PAYPAL_REFUSED_PAYMENT: "PayPal a refusé le paiement : {issue}.",
      CAPTURE_PENDING: "PayPal n'a pas encore crédité l'encaissement.",
      CAPTURE_NOT_COMPLETED: "L'encaissement PayPal ne s'est pas terminé.",
      MANDATE_CHANGED_BEFORE_CAPTURE: "Revérifié au moment du déblocage, le mandat ne l'autorise plus.",
    },
    explain: {
      REFUSED_BY_GATE: "Non payé. {fails} Aucun appel à PayPal n'a été fait.",
      ALREADY_CAPTURED: "Pas de second paiement : cette facture a déjà été encaissée (reçu {receipt}).",
      PAYER_NOT_APPROVED: "Non payé. Le payeur n'a pas approuvé cette commande sur PayPal (statut {status}).",
      RELEASE_NOT_ACKNOWLEDGED: "Pas encore payé. Le déblocage n'a pas confirmé la lecture de : {missing}.",
      RELEASE_REQUIRED: "Pas encore payé. Une personne doit débloquer ce paiement dans l'app.",
      PAID: "Payé. Le mandat l'autorisait et le payeur l'a approuvé sur PayPal.",
      PAID_BY: "Payé. Le mandat l'autorisait, le payeur l'a approuvé sur PayPal, et {by} l'a débloqué.",
      PAID_TEST_PAYER: "Payé dans le bac à sable. Le mandat l'autorisait, et la carte de test de PayPal a tenu le rôle du payeur.",
      PAID_TEST_PAYER_BY: "Payé dans le bac à sable. Le mandat l'autorisait, la carte de test de PayPal a tenu le rôle du payeur, et {by} l'a débloqué.",
      CAPTURE_STATUS: "L'encaissement a renvoyé le statut {status}.",
      DECLINED: "Non payé. {by} a refusé : {reason}. PayPal n'indique aucun encaissement pour cette commande.",
      TOOL_REFUSED: "Non exécuté. {fails} PayPal n'a pas été sollicité.",
      TOOL_DONE: "Fait. Le mandat autorisait {tool}, et PayPal l'a exécuté.",
      TOOL_DONE_BY: "Fait. Le mandat autorisait {tool}, {by} l'a débloqué, et PayPal l'a exécuté.",
      TOOL_FAILED_AT_PAYPAL: "Pas fait. PayPal a refusé {tool}.", TOOL_FAILED_AT_PAYPAL_SIM: "Pas fait. Le PayPal simulé a refusé {tool}.",
      TOOL_DONE_SIM: "Fait. Le mandat autorisait {tool}, et le PayPal simulé l'a exécuté.", TOOL_DONE_BY_SIM: "Fait. Le mandat autorisait {tool}, {by} l'a débloqué, et le PayPal simulé l'a exécuté.",
      TOOL_NOT_SENT_BY_PAYPAL_TOOLS: "Pas fait. Le serveur d'outils de PayPal a échoué avant d'envoyer {tool} à l'API de paiement de PayPal ({code} : {message}). Une panne de la connexion aux outils de PayPal, pas un refus de PayPal.",
      TOOL_OUTCOME_UNKNOWN: "Issue inconnue. PayPal n'a pas répondu à {tool} ; vérifier chez PayPal avant de réessayer.",
      TOOL_DECLINED: "Non exécuté. {by} a refusé : {reason}. PayPal n'a pas été sollicité.",
      TOOL_RELEASE_NOT_ACKNOWLEDGED: "Pas encore exécuté. Le déblocage n'a pas confirmé la lecture de : {missing}.",
      TOOL_ALREADY_RAN: "Pas de seconde fois. PayPal a déjà exécuté cet appel (reçu {receipt}).",
      ALREADY_PAID_AT_PAYPAL: "Pas de second paiement. PayPal détient déjà un paiement terminé pour la facture {invoice} (DUPLICATE_INVOICE_ID).",
      REFUSED_BY_PAYPAL: "Non payé. PayPal a refusé le paiement ({issue}) ; rien n'a été pris.",
      CAPTURE_PENDING: "Pas encore payé. PayPal a accepté l'encaissement mais ne l'a pas encore crédité (PENDING) ; il ne compte comme payé que quand PayPal dit COMPLETED.",
      MANDATE_CHANGED: "Non payé. Entre la revue et le déblocage, le mandat a cessé d'autoriser ce paiement.",
      TOOL_MANDATE_CHANGED: "Non exécuté. Entre la demande et le déblocage, le mandat a cessé d'autoriser {tool} ; PayPal n'a pas été sollicité.",
    },
    evkeys: { provider: "source", order_id: "commande", order_status: "statut de la commande", authorization_id: "autorisation", authorization_status: "statut de l'autorisation", capture_id: "encaissement", capture_status: "statut de l'encaissement", payee_at_paypal: "bénéficiaire chez PayPal", payer_source: "payeur", checked_at: "vérifié le" },
  },
};

const $ = (sel) => document.querySelector(sel);
const fill = (tpl, vars = {}) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
};

function initialLang() {
  try { const saved = localStorage.getItem("anima.lang"); if (saved === "fr" || saved === "en") return saved; } catch { /* storage may be blocked */ }
  return (navigator.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
}
let lang = initialLang();
const t = (key, vars) => fill(I18N[lang][key] ?? I18N.en[key] ?? key, vars);
const fr = () => lang === "fr";
const money = (cents, cur = "EUR") => fr() ? `${(cents / 100).toFixed(2).replace(".", ",")} ${cur === "EUR" ? "€" : cur}` : `${(cents / 100).toFixed(2)} ${cur}`;

/** French for a known English sentence from the demo script; a real model's words stay as given. */
function tx(text) {
  if (!fr() || !text) return text;
  const map = state?.fr?.reasons ?? {};
  if (map[text]) return map[text];
  let out = text, hit = false;
  for (const [en, f] of Object.entries(map)) if (out.includes(en)) { out = out.split(en).join(f); hit = true; }
  return hit ? out : text + I18N.fr.untranslated;
}
const verdictLabel = (v) => (fr() ? I18N.fr.verdict : I18N.en.verdict)[v] ?? v;
const statusLabel = (s) => I18N[lang].status?.[s] ?? s;
const approvalLabel = (a) => I18N[lang].approvalv?.[a] ?? a;
const rtypeLabel = (r) => I18N[lang].rtype?.[r] ?? r;
const recLabel = (r) => (fr() ? I18N.fr.rec[r] ?? r : r);
/** A run the live model could not answer says why, in French too. */
const advisorLabel = (m) => {
  if (!fr() || !/scripted/.test(m)) return m;
  const down = /live model unavailable: ([^)]*)/.exec(m);
  if (down) return t("scripted_unavailable", { w: down[1] });
  return /daily budget/.test(m) ? I18N.fr.scripted_budget : I18N.fr.scripted;
};
/** PayPal's own status word stays visible (it is the evidence); French adds its meaning beside it. */
const PAYPAL_FR = { COMPLETED: "encaissé", CAPTURED: "encaissée", APPROVED: "approuvée par le payeur", CREATED: "créée, en attente du payeur", PAYER_ACTION_REQUIRED: "en attente du payeur", VOIDED: "annulée", PENDING: "en cours" };
const paypalStatus = (s) => (s && fr() && PAYPAL_FR[s] ? `${s} (${PAYPAL_FR[s]})` : s);
/** A tool's status is not a capture: COMPLETED there means the refund or the action is done. */
const TOOL_STATUS_FR = { COMPLETED: "terminé", PENDING: "en cours", FAILED: "échoué", CANCELLED: "annulé", OPEN: "ouvert", RESOLVED: "réglé" };
const toolStatus = (s) => (s && fr() && TOOL_STATUS_FR[s] ? `${s} (${TOOL_STATUS_FR[s]})` : s);

function findingText(f) {
  if (!fr()) return f.message;
  const tpl = (f.params?.source === "simulated" && I18N.fr.finding[`${f.id}_SIM`]) || I18N.fr.finding[f.id];
  if (!tpl) return f.message;
  const p = { ...(f.params || {}) };
  if (p.reasons) p.reasons = tx(String(p.reasons));
  if (p.date) p.date = String(p.date).split("-").reverse().join("/");
  return fill(tpl, { ...p, message: tx(f.message) });
}

function explanationText(r) {
  if (!fr()) return r.explanation;
  const p = r.explanation_params || {};
  if (r.explanation_code === "REFUSED_BY_GATE") {
    return fill(I18N.fr.explain.REFUSED_BY_GATE, { fails: r.findings.filter((f) => f.impact === "fail").map(findingText).join(" ") });
  }
  if (r.explanation_code === "PAID" && p.by) return fill(I18N.fr.explain.PAID_BY, p);
  if (r.explanation_code === "PAID_TEST_PAYER" && p.by) return fill(I18N.fr.explain.PAID_TEST_PAYER_BY, p);
  // Only a call PayPal's own tools answered may say PayPal ran or refused it.
  const sim = r.provider === "paypal-sandbox-mcp-simulator" ? "_SIM" : "";
  if (r.explanation_code === "TOOL_DONE") return fill(I18N.fr.explain[`TOOL_DONE${p.by ? "_BY" : ""}${sim}`], p);
  if (r.explanation_code === "TOOL_REFUSED") return fill(I18N.fr.explain.TOOL_REFUSED, { fails: r.findings.filter((f) => f.impact === "fail").map(findingText).join(" ") });
  const tpl = I18N.fr.explain[`${r.explanation_code}${sim}`] ?? I18N.fr.explain[r.explanation_code];
  return tpl ? fill(tpl, { ...p, reason: tx(String(p.reason ?? "")) }) : r.explanation;
}

function requestText(r) {
  if (!fr()) return r.requested_action;
  return fill(I18N.fr.request, { a: money(r.request.amount_cents, r.request.currency), m: r.request.merchant, n: r.request.invoice_number });
}

const isTool = (r) => r && r.schema === "anima.tool_receipt.v0";
const classLabel = (k) => t(`class_${k}`);
/** What a tool call would do, in one line: tool, the amount PayPal reported, who it reaches. */
function toolLine(callObj, resolved) {
  const parts = [callObj.tool];
  if (resolved?.amount_cents !== undefined) parts.push(money(resolved.amount_cents, resolved.currency || "EUR"));
  const target = Object.entries(callObj.args || {}).find(([k, v]) => (k === "id" || k.endsWith("_id")) && typeof v === "string");
  if (target) parts.push(`${target[0]} ${target[1]}`);
  if (resolved?.recipients?.length) parts.push(t("tool_recipients", { x: resolved.recipients.join(", ") }));
  return parts.join(" · ");
}
const needsFacts = (klass) => klass === "money" || klass === "outreach";
/** A label naming the source: the simulated PayPal's wording when the facts came from the simulator. */
const ts = (key, source, vars) => t(source === "simulated" ? `${key}_sim` : key, vars);
function factsLine(resolved, source) {
  const bits = [];
  if (resolved?.amount_cents !== undefined) bits.push(money(resolved.amount_cents, resolved.currency || "EUR"));
  if (resolved?.recipients) bits.push(t("tool_recipients", { x: resolved.recipients.join(", ") || "—" }));
  return bits.length ? ts("tool_read_from", source, { x: bits.join(" · ") }) : t("tool_nothing_read");
}

async function call(method, url, payload) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status });
  return json;
}

let state = null;
let sealed = [];
const ranScenes = new Set();
// The theatre plays once, right after a run; later renders only mark what changed.
let playNext = false;
const lockMemo = {};
const knownReceipts = new Set();
let receiptsPrimed = false;
let grid = null;
let proofScope = "all";
let proofQuery = "";
let proofTotal = 0;
let proofAutoOpened = false;
let lastRun = null;
let openId = null;
const OWNER = "Studio Lumen";

function pill(verdict) { return el("span", { class: `pill ${verdict}` }, verdictLabel(verdict)); }

function renderStatic() {
  document.documentElement.lang = lang;
  document.title = fr() ? "ANIMA — des paiements d'agents avec reçus" : "ANIMA — agent payments with receipts";
  for (const [id, key] of [["catchphrase", "catchphrase"], ["t-mandate-title", "mandate_title"], ["t-mandate-hint", "mandate_hint"],
    ["t-scenes-title", "scenes_title"], ["t-scenes-hint", "scenes_hint"], ["reset", "reset"], ["t-waiting-title", "waiting_title"], ["pending-empty", "waiting_empty"],
    ["t-receipts-title", "receipts_title"], ["t-receipts-hint", "receipts_hint"], ["t-trust-title", "trust_title"], ["t-trust-hint", "trust_hint"],
    ["t-eyebrow", "eyebrow"], ["t-lede", "lede"], ["run-first", "cta_run"], ["run-poison", "cta_poison"], ["t-mandate-kind", "mandate_kind"],
    ["t-mandate-signed", "mandate_signed"], ["t-forensic", "forensic"],
    ["t-proof-heading", "proof_heading"], ["t-proof-hint", "proof_hint"],
    ["t-proof-search", "proof_search"], ["t-proof-footnote", "proof_footnote"]]) $(`#${id}`).textContent = t(key);
  $("#t-question").replaceChildren(t("q1"), el("em", {}, t("q2")), t("q3"));
  $("#proof-search").placeholder = t("proof_search_hint");
  for (const b of document.querySelectorAll("#proof-scopes button")) {
    b.textContent = t("proof_" + b.dataset.proofScope.replace("notMoved", "not_moved").replace("moved", "moved"));
    b.setAttribute("aria-pressed", String(b.dataset.proofScope === proofScope));
  }
  renderChain();
  for (const b of document.querySelectorAll("#lang button")) b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
}

/** How money moves, in one line: the agent proposes, three locks, a signed receipt. */
function renderChain() {
  const node = (key, cls = "") => el("li", {}, el("span", { class: `node ${cls}` }, t(key)));
  $("#chain").replaceChildren(node("chain_agent"), node("chain_mandate", "guard"), node("chain_payer", "guard"), node("chain_seal", "guard"), node("chain_receipt", "end"));
}

const STREAK_FOR_STEP = 3;

/** Earned autonomy, per merchant: how far the agent may pay alone, the ladder, and the record it rests on. */
function renderTrust(list) {
  const anomaly = (r) => (fr() ? I18N.fr.anomaly[r] ?? r : r.toLowerCase().replace(/_/g, " "));
  $("#trust").replaceChildren(...list.map((tr) => {
    // The same ladder as the server's: every payment waits, then 60 % of the ceiling, then the ceiling.
    const rungs = [0, Math.round(tr.ceiling_cents * 0.6), tr.ceiling_cents].filter((c, i, a) => a.indexOf(c) === i);
    const cols = `grid-template-columns: repeat(${rungs.length}, 1fr)`;
    // The record: every receipt for this merchant, and every grant or reset, in time order.
    const events = [
      ...state.receipts.filter((r) => r.request.merchant === tr.merchant).map((r) => ({ at: r.created_at, kind: r.money_moved && r.verdict === "pass" && !r.corrections.length ? "clean" : "anomaly", label: `${r.request.invoice_number} · ${statusLabel(r.status)}` })),
      ...tr.curve.map((c) => ({ at: c.at, kind: c.why, label: c.why === "grant" ? t("trust_level", { x: money(c.cents) }) : t("trust_reset") })),
    ].sort((a, b) => (a.at < b.at ? -1 : 1)).slice(-12);
    return el("div", { class: "trust-row" },
      el("div", { class: "who" },
        el("strong", {}, tr.merchant),
        el("div", { class: "level" }, money(tr.granted_cents)),
        el("span", { class: "muted" }, tr.granted_cents ? t("trust_alone") : t("trust_none"))),
      el("div", {},
        el("div", { class: "ladder", style: cols, role: "img", "aria-label": tr.granted_cents ? t("trust_level", { x: money(tr.granted_cents) }) : t("trust_none") },
          rungs.map((c) => el("span", { class: `rung ${tr.granted_cents >= c ? "on" : ""}` }))),
        el("div", { class: "ladder-labels", style: cols }, rungs.map((c) => el("span", {}, c ? t("ladder_n", { x: money(c) }) : t("ladder_0"))))),
      el("div", { class: "next" },
        el("ol", { class: "record", "aria-label": t("trust_record") },
          events.length ? events.map((e) => el("li", { class: e.kind, title: e.label })) : el("li", { class: "none" }, t("trust_no_record"))),
        el("div", {}, el("span", { class: "dots" }, [0, 1, 2].map((i) => el("i", { class: i < Math.min(tr.streak, STREAK_FOR_STEP) ? "on" : "" }))),
          t("trust_streak", { n: Math.min(tr.streak, STREAK_FOR_STEP), k: STREAK_FOR_STEP })),
        tr.last_anomaly ? el("div", { class: "muted" }, t("trust_anomaly", { r: anomaly(tr.last_anomaly.reason) })) : "",
        tr.proposal ? el("button", { class: "small seal-step", onclick: () => act(() => call("POST", "/api/trust/grant", { merchant: tr.merchant, by: OWNER })) }, t("trust_seal", { x: money(tr.proposal.to_cents) })) : ""));
  }));
}

/** The live status line: which PayPal, which advisor, the last sealed receipt. */
function renderModes(mode) {
  // A sealed ledger on the real sandbox is never erased: no "start over" there.
  $("#reset").hidden = mode.paypal === "paypal-sandbox";
  const real = mode.paypal === "paypal-sandbox";
  // The chain also seals corrections and trust grants: the status names the last receipt.
  const last = [...sealed].reverse().find((e) => e.receipt_id && e.created_at) ?? null;
  $("#status").replaceChildren(
    el("span", { class: real ? "real" : "sim" }, el("i", { class: "dot", "aria-hidden": "true" }), el("strong", {}, real ? t("status_real") : t("status_sim")), " · ", real ? t("status_real_v") : t("status_sim_v")),
    mode.tools_fallback ? el("span", { class: "sim" }, el("i", { class: "dot", "aria-hidden": "true" }), el("strong", {}, t("status_tools_sim")), " · ", t("status_tools_sim_v", { time: mode.tools_fallback.at.slice(11, 16) })) : "",
    el("span", {}, t("advisor", { m: advisorLabel(mode.advisor) })),
    el("span", {}, last ? t("status_last", { t: last.created_at.slice(11, 19), i: last.seal.index }) : t("status_none")),
  );
}

function renderMandate(m) {
  const rows = [
    [t("purpose"), fr() ? state.fr.mandate_purpose : m.purpose], [t("payees"), m.merchants.join(", ")],
    [t("per_payment"), t("up_to", { x: money(m.max_per_payment_cents, m.currency) }), "amount"],
    [t("per_days", { d: m.period_days }), t("up_to", { x: money(m.max_per_period_cents, m.currency) }), "amount"],
    [t("releases"), t("releases_v", { x: money(m.human_release_above_cents, m.currency) })],
    [t("expires"), fr() ? m.expires_at.slice(0, 10).split("-").reverse().join("/") : m.expires_at.slice(0, 10)],
  ];
  $("#mandate").replaceChildren(...rows.flatMap(([k, v, cls]) => [el("dt", {}, k), el("dd", { class: cls }, v)]));
  $("#mandate-id").textContent = m.id;
  $("#mandate-signer").textContent = OWNER;
}

function sceneText(s) { return fr() ? state.fr.scenes[s.n] : { title: s.title, teaches: s.teaches }; }

function renderScenes(scenes) {
  $("#scenes").replaceChildren(...scenes.map((s) => el("button", { class: `case ${ranScenes.has(s.n) ? "done" : ""}`, onclick: () => runScene(s.n) },
    el("span", { class: "n" }, t("scene", { n: s.n })), el("span", { class: "go", "aria-hidden": "true" }, ranScenes.has(s.n) ? "✓" : "→"),
    el("strong", {}, sceneText(s).title), el("span", { class: "t" }, sceneText(s).teaches))));
}

function councilBlock(d) {
  if (!d) return "";
  const voice = (role, rec, reasons, objects) => el("li", { class: objects ? "objects" : "" },
    el("strong", {}, `${t(role)} — ${rec}`), " ", reasons.map(tx).join(" "));
  return el("div", { class: "council" },
    el("ul", {},
      voice("proposer", recLabel(d.proposer.recommendation), d.proposer.reasons, false),
      voice("adversary", t(`stance_${d.adversary.stance}`), d.adversary.reasons, d.adversary.stance === "OBJECT"),
      voice("verifier", t(`stance_${d.verifier.stance}`), d.verifier.reasons, d.verifier.stance === "OBJECT")),
    d.dissent ? el("p", { class: "dissent" }, t("dissent_note")) : "");
}

/** The invoice as it arrived; text hidden from a human reader (an HTML comment) is marked, red once the adversary caught it. */
function invoicePaper(text, caught) {
  const parts = text.split(/(<!--[\s\S]*?-->)/);
  return el("pre", {}, parts.map((p) => (/^<!--/.test(p) ? el("span", { class: `hidden-text ${caught ? "caught beat" : ""}`, style: "--t:1.05s" }, p) : p)));
}

/** The decision theatre: the rail of steps, the invoice on paper, three voices, three locks, the verdict, the receipt.
 *  Right after a run, it plays as one sequence (cause, then effect); afterwards it only marks what changed. */
function renderTheatre() {
  const box = $("#theatre");
  const run = lastRun;
  if (!run) { box.hidden = true; return; }
  const play = playNext;
  playNext = false;
  box.classList.toggle("play", play);
  if (run.steps) { renderToolTheatre(box, run); return; }
  const scene = state.scenes.find((s) => s.n === run.scene);
  const number = run.advice.read.invoice_number || scene.invoice_text.match(/[A-Z]{2}-\d{4}/)?.[0];
  const receipt = run.receipt ?? state.receipts.find((r) => r.request.invoice_number === number);
  const pending = state.pending.find((p) => p.key === run.pending_key);
  // The mandate's validity and the gate's decision are two facts (web/theatre.js): an invoice already paid is
  // refused by the gate while the mandate stays valid.
  const facts = animaTheatre.theatreFacts(run, receipt, pending);
  const { verdict } = facts;
  const refused = facts.gateRefused;
  const memo = (k, s) => { const key = `${run.scene}:${k}`; const changed = !play && lockMemo[key] !== undefined && lockMemo[key] !== s; lockMemo[key] = s; return changed; };
  const lock = (label, s, at) => el("li", { class: `lock ${s} beat ${memo(label, s) ? "flip" : ""}`, style: `--t:${at}s` },
    el("span", { class: "shackle", "aria-hidden": "true" }), el("strong", {}, t(label)), el("span", { class: "state" }, t(`lock_${s}`)));
  const voice = (role, cls, head, reasons, at) => el("article", { class: `voice ${cls} beat`, style: `--t:${at}s` },
    el("header", {}, el("span", { class: "role" }, t(role)), el("span", { class: "stance" }, head)), el("p", {}, reasons.map(tx).join(" ")));
  const c = run.council;
  // Each step lights when its cause has played.
  const at = { propose: 0.3, challenge: 0.9, verify: 1.5, mandate: 2.1, gate: 2.3, payer: 2.5, seal: 2.9, receipt: 3.3 };
  const steps = facts.rail.map(([k, s]) => [k, s, at[k]]);
  box.replaceChildren(
    el("div", { class: "stage-head" },
      el("div", { class: "titles" }, el("span", { class: "n" }, t("th_scene", { n: run.scene })), el("h2", {}, sceneText(scene).title)),
      el("span", { class: "beat", style: "--t:3.3s" }, pill(verdict))),
    el("ol", { class: "rail" }, steps.map(([k, s, at]) => el("li", { class: `${s} ${memo(`rail-${k}`, s) ? "flip" : ""}`, style: `--t:${at}s` }, t(`rail_${k}`)))),
    el("div", { class: "stage" },
      el("figure", { class: "paper" }, el("figcaption", {}, t("th_invoice")), invoicePaper(scene.invoice_text, c.adversary.stance === "OBJECT")),
      el("div", { class: "voices" },
        voice("proposer", "proposer", recLabel(c.proposer.recommendation), c.proposer.reasons, 0.3),
        voice("adversary", c.adversary.stance === "OBJECT" ? "objects" : "agrees", t(`stance_${c.adversary.stance}`), c.adversary.reasons, 0.9),
        voice("verifier", c.verifier.stance === "OBJECT" ? "objects" : "agrees", t(`stance_${c.verifier.stance}`), c.verifier.reasons, 1.5)),
      el("aside", { class: "gate" },
        el("pre", { class: "wizard beat", style: "--t:1.9s", "aria-hidden": "true" }, state.wizard.join("\n")),
        el("ul", { class: "locks", "aria-label": t("th_locks") },
          lock("lock_mandate", facts.locks.mandate, 2.1),
          lock("lock_payer", facts.locks.payer, 2.5),
          lock("lock_person", facts.locks.person, 2.9)))),
    el("div", { class: `verdict ${verdict} beat`, style: "--t:3.3s" }, pill(verdict),
      el("div", {}, el("div", { class: "phrase" }, fr() ? I18N.fr.phrase[verdict] : state.phrases[verdict]),
        el("p", {}, refused ? t("refused_before", { x: explanationText(run.receipt) }) : receipt ? t("sealed_below", { i: sealOf(receipt.receipt_id)?.seal.index ?? "—" }) : t("passed")))),
    receipt?.corrections?.length ? el("div", { class: "seam-line", role: "note" }, `✦ ${t("seam")} — ${tx(receipt.corrections[0].replacement)}`) : "",
    receipt ? el("div", { class: "beat", style: "--t:3.7s" }, proofCard(receipt)) : "",
    run.scene === 3 && refused ? el("aside", { class: "compare-next", role: "region", "aria-label": t("next_step") },
      el("p", { class: "eyebrow" }, t("next_step")),
      el("h3", {}, t("next_clean_title")),
      el("p", { class: "muted" }, t("next_clean_text")),
      el("button", { class: "primary", onclick: () => runScene(1) }, t("next_clean_cta"))) : "",
  );
  box.hidden = false;
}

/** Scene 7 on stage: every call the agent made to PayPal's tools, across the firewall: what it asked,
 *  what ANIMA decided, and what reached PayPal. Rows and totals read one view of each call's final
 *  outcome (web/firewall.js), so a call a person released counts where its row says it went. */
function renderToolTheatre(box, run) {
  const scene = state.scenes.find((s) => s.n === 7);
  const verdictOf = { read: "pass", read_failed: "pass", done: "pass", held: "hold", refused: "fail", paypal_refused: "fail", tools_failed: "fail", unknown: "hold", error: "fail" };
  const reached = { read: "fw_read", read_failed: "fw_read_failed", done: "fw_done", held: "fw_held", refused: "fw_never", paypal_refused: "fw_paypal_refused", tools_failed: "fw_tools_failed", unknown: "fw_unknown", error: "fw_error" };
  const mark = { read: "✓", read_failed: "!", done: "✓", held: "‖", refused: "✕", paypal_refused: "✕", tools_failed: "!", unknown: "?", error: "!" };
  const view = animaFirewall.firewallView(run, state.tool_receipts || [], state.tool_pending || []);
  const deskSource = animaFirewall.factsSource(null, state.mode);
  const rows = view.rows.map(({ step: s, receipt, pending, kind }, i) => {
    const source = animaFirewall.factsSource(receipt ?? pending ?? s, state.mode);
    const resolved = receipt?.resolved ?? pending?.resolved;
    const findings = (receipt?.findings ?? pending?.findings ?? []).filter((f) => f.impact !== "info");
    return el("li", { class: `fw-row ${kind} beat`, style: `--t:${0.35 + i * 0.5}s` },
      el("div", { class: "fw-ask" },
        el("header", {}, el("code", {}, s.call.tool), el("span", { class: "klass" }, classLabel(state.tool_classes?.[s.call.tool] ?? receipt?.klass ?? pending?.klass ?? "null"))),
        el("p", { class: "muted" }, t("tool_reason", { r: tx(s.call.reason) })),
        resolved && Object.keys(resolved).length ? el("p", { class: "facts" }, factsLine(resolved, source)) : ""),
      el("div", { class: "fw-gate" },
        el("div", {}, pill(receipt?.verdict ?? verdictOf[kind]), " ", el("span", { class: "step" }, ts(`step_${kind}`, ["done", "paypal_refused", "tools_failed", "unknown"].includes(kind) ? source : "paypal"))),
        findings.length ? el("ul", {}, findings.map((f) => el("li", {}, findingText(f)))) : ""),
      el("div", { class: "fw-paypal" },
        el("span", { class: "reach", "aria-hidden": "true" }, mark[kind]),
        el("div", {}, el("strong", {}, ts(reached[kind], ["read", "read_failed", "done", "paypal_refused", "tools_failed", "unknown"].includes(kind) ? source : "paypal")),
          s.read ? el("p", { class: "muted" }, s.read.ok ? ts("tool_read_ok", source, { x: s.read.fields.join(", ") || "—" }) : ts("tool_read_err", source, { x: s.read.error })) : "",
          receipt && kind !== "read" ? el("p", { class: "muted" }, explanationText(receipt)) : "",
          s.error ? el("p", { class: "muted" }, s.error) : "")));
  });
  const n = view.totals;
  box.replaceChildren(
    el("div", { class: "stage-head" },
      el("div", { class: "titles" }, el("span", { class: "n" }, t("th_scene", { n: 7 })), el("h2", {}, sceneText(scene).title)),
      el("div", { class: "fw-sum" },
        el("span", { class: "chip ok" }, ts("fw_sum_read", deskSource, { n: n.sent, s: n.sent > 1 ? "s" : "" })),
        el("span", { class: "chip wait" }, t("fw_sum_held", { n: n.held, s: n.held > 1 ? "s" : "" })),
        el("span", { class: "chip stop" }, t("fw_sum_refused", { n: n.refused, s: n.refused > 1 ? "s" : "" })),
        n.unclear ? el("span", { class: "chip wait" }, t("fw_sum_unclear", { n: n.unclear })) : "")),
    run.tools_fallback ? el("p", { class: "fw-fallback", role: "note" }, t("fw_fallback", { ...run.tools_fallback, time: run.tools_fallback.at.slice(11, 16) })) : "",
    el("p", { class: "fw-lede" }, t("tool_hint")),
    el("div", { class: "fw-head", "aria-hidden": "true" }, el("span", {}, t("fw_col_agent")), el("span", {}, t("fw_col_anima")), el("span", {}, ts("fw_col_paypal", deskSource))),
    el("ol", { class: "firewall" }, rows),
    ...run.skipped.map((x) => el("p", { class: "muted" }, t("tool_skipped", { x }))));
  box.hidden = false;
}

/** The copper stamp: SEALED around a check, or REFUSED around a cross. Every receipt is sealed in the chain. */
let stampCount = 0;
function stamp(verdict) {
  const ns = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const id = `arc-${++stampCount}`;
  const word = verdict === "pass" ? t("stamp_sealed") : t("stamp_refused");
  const svg = mk("svg", { viewBox: "0 0 64 64", class: "stamp", "aria-hidden": "true" });
  const defs = mk("defs", {});
  defs.append(mk("path", { id, d: "M32 32 m-23 0 a23 23 0 1 1 46 0 a23 23 0 1 1 -46 0" }));
  const text = mk("text", {});
  const tp = mk("textPath", { href: `#${id}` });
  tp.textContent = `${word} · ANIMA · ${word} · ANIMA ·`;
  text.append(tp);
  svg.append(defs, mk("circle", { cx: 32, cy: 32, r: 30, "stroke-width": 1.6 }), mk("circle", { cx: 32, cy: 32, r: 16, "stroke-width": 1 }),
    mk("path", { d: verdict === "pass" ? "M25.5 32.5l4.5 4.5 9-9.5" : "M26.5 26.5l11 11M37.5 26.5l-11 11" }), text);
  return svg;
}

/** A receipt as a proof object: what was asked, what happened, PayPal's evidence, and its seal in the chain. */
function proofCard(r) {
  const tool = isTool(r);
  const s = sealOf(r.receipt_id);
  const ev = r.evidence;
  const amount = tool ? (r.resolved?.amount_cents !== undefined ? money(r.resolved.amount_cents, r.resolved.currency || "EUR") : r.call.tool) : money(r.request.amount_cents, r.request.currency);
  const to = tool ? toolLine(r.call, r.resolved) : `→ ${r.request.merchant} · ${r.request.invoice_number}`;
  const paypal = tool
    ? (r.result ? [...Object.values(r.result.ids || {}), toolStatus(r.result.status || "")].filter(Boolean).join(" · ") || "—" : t("no_call_tool"))
    : (ev ? [ev.capture_id || ev.order_id, paypalStatus(ev.capture_status || ev.authorization_status || ev.order_status)].filter(Boolean).join(" · ") : t("no_call"));
  const approval = tool ? (r.release ? approvalLabel("human_release") : "—") : approvalLabel(r.boundary.approval);
  const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");
  const fresh = receiptsPrimed && !knownReceipts.has(r.receipt_id);
  return el("button", { type: "button", class: `proof ${r.verdict}${fresh ? " fresh" : ""}`, onclick: () => openDrawer(r.receipt_id), title: t("open_receipt") },
    el("div", { class: "proof-top" }, el("span", {}, `${tool ? t("tool_kind") : t("receipt_kind")}${s ? ` · #${s.seal.index}` : ""}`), el("time", {}, `${r.created_at.slice(0, 10)} ${r.created_at.slice(11, 19)} UTC`)),
    el("div", {}, el("div", { class: "proof-amount" }, amount), el("div", { class: "proof-to" }, to)),
    el("p", { class: "proof-outcome" }, explanationText(r)),
    el("dl", { class: "proof-ev" },
      el("dt", {}, t("ev_paypal")), el("dd", {}, simulatedAmongReal(r) ? `${t("sim_tag")} · ${paypal}` : paypal),
      el("dt", {}, t("ev_approval")), el("dd", {}, approval),
      el("dt", {}, t("ev_moved")), el("dd", {}, movedLabel(r))),
    el("div", { class: "proof-seal" }, stamp(r.verdict === "pass" ? "pass" : "fail"),
      el("div", { class: "seal-lines" },
        el("div", {}, el("b", {}, t("seal_chain")), ` #${s?.seal.index ?? "—"} · `, el("b", {}, t("seal_hash")), ` ${short(s?.seal.hash)}`),
        el("div", {}, el("b", {}, t("seal_sig")), ` ${short(s?.seal.sig)}`),
        el("div", {}, el("b", {}, t("seal_key")), ` ${s?.seal.key_id ?? "—"}`))),
    (r.corrections ?? []).length ? el("div", { class: "proof-seam" }, el("span", { class: "seam" }, "✦"), `${t("seam")} — ${tx(r.corrections[0].replacement)}`) : "");
}

function renderProofs() {
  const all = [...state.receipts, ...(state.tool_receipts || [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  $("#proofs").replaceChildren(...(all.length ? all.slice(0, 3).map(proofCard) : [el("p", { class: "proof-empty" }, t("proof_empty"))]));
  $("#forensic-count").textContent = all.length ? `(${t("receipts_n", { n: all.length })})` : "";
  // The grid is a useful witness only after a decision exists. Let the visitor close it again.
  if (all.length && !proofAutoOpened) { $("#forensic").open = true; proofAutoOpened = true; }
}

const sealOf = (id) => sealed.find((e) => e.receipt_id === id) ?? null;

function renderLastRun() {
  const box = $("#last-run");
  const run = lastRun;
  if (!run) { box.hidden = true; return; }
  const scene = state.scenes.find((s) => s.n === run.scene);
  const read = run.advice.read;
  const said = t("read_to", { r: recLabel(run.advice.recommendation), a: read.amount_cents ? money(read.amount_cents, read.currency) : t("nothing"), m: read.merchant || "?" });
  const outcome = run.outcome === "refused" ? t("refused_before", { x: explanationText(run.receipt) }) : t("passed");
  box.replaceChildren(
    el("h2", {}, t("scene_head", { n: run.scene, t: sceneText(scene).title })),
    el("p", {}, el("strong", {}, t("model_said")), said),
    el("p", { class: "muted" }, run.advice.reasons.map(tx).join(" ")),
    run.council ? el("h3", {}, t("council")) : "",
    councilBlock(run.council),
    el("p", {}, el("strong", {}, t("outcome")), outcome),
    el("details", {}, el("summary", {}, t("invoice_text")), el("pre", {}, scene.invoice_text)),
  );
  box.hidden = false;
}

function renderPending(list, tools = []) {
  const total = list.length + tools.length;
  $("#pending-count").textContent = total ? `(${total})` : "";
  $("#pending-empty").hidden = total > 0;
  $("#pending").replaceChildren(...tools.map(toolCard), ...list.map((p) => {
    const acks = new Set();
    const ackBoxes = p.holds.map((h) => {
      const f = p.findings.find((x) => x.id === h);
      const box = el("input", { type: "checkbox", onchange: (e) => (e.target.checked ? acks.add(h) : acks.delete(h)) });
      return el("label", { class: "ack" }, box, t("have_read", { m: f ? findingText(f) : h }));
    });
    const simulated = state.mode.paypal !== "paypal-sandbox";
    const payer = p.payer_approved
      ? el("span", { class: "muted" }, t("approved_sim"))
      : simulated
        ? el("button", { class: "ghost", onclick: () => act(() => call("POST", `/api/pending/${p.key}/approve`)) }, t("approve_sim"))
        : p.stand_in
          ? el("span", { class: "muted" }, t("pp_card"))
          : [el("a", { class: "button", href: p.approve_url }, t("approve_real")),
             el("button", { class: "ghost", onclick: () => act(() => call("POST", `/api/pending/${p.key}/test-payer`)) }, t("test_payer"))];
    return el("div", { class: "slip" },
      el("header", {}, el("strong", {}, `${p.invoice.number} · ${p.invoice.merchant} · ${money(p.invoice.amount_cents, p.invoice.currency)}`), pill(p.verdict)),
      el("div", { class: "muted" }, t("model_line", { r: recLabel(p.recommendation), why: p.reasons.map(tx).join(" ") })),
      p.findings.length ? el("ul", {}, p.findings.map((f) => el("li", {}, findingText(f)))) : "",
      simulated ? "" : el("div", { class: "muted paypal-live", "data-key": p.key }, t("pp_checking")),
      ...ackBoxes,
      el("div", { class: "actions" },
        payer,
        el("button", { onclick: () => act(() => call("POST", `/api/pending/${p.key}/release`, p.human_release_required ? { by: OWNER, acknowledged: [...acks] } : {})) },
          p.human_release_required ? t("release") : t("capture")),
        el("button", { class: "warn", onclick: () => act(() => call("POST", `/api/pending/${p.key}/decline`, { by: OWNER, reason: "declined after review" })) }, t("decline")),
      ),
    );
  }));
}

/** A call to PayPal's tools held by the firewall: the facts read from PayPal, the holds, and the person's choice. */
function toolCard(p) {
  const acks = new Set();
  return el("div", { class: "slip tool" },
    el("header", {}, el("strong", {}, `${t("tools_head")} · ${toolLine(p.call, p.resolved)}`), el("span", { class: "klass" }, classLabel(p.klass ?? "null")), pill(p.verdict === "fail" ? "fail" : "hold")),
    el("div", { class: "muted" }, t("tool_reason", { r: tx(p.call.reason) })),
    needsFacts(p.klass) ? el("div", {}, factsLine(p.resolved, animaFirewall.factsSource(p, state.mode))) : "",
    p.findings.length ? el("ul", {}, p.findings.map((f) => el("li", {}, findingText(f)))) : "",
    ...p.holds.map((h) => {
      const f = p.findings.find((x) => x.id === h);
      return el("label", { class: "ack" }, el("input", { type: "checkbox", onchange: (e) => (e.target.checked ? acks.add(h) : acks.delete(h)) }), t("have_read", { m: f ? findingText(f) : h }));
    }),
    el("div", { class: "actions" },
      el("button", { onclick: () => act(() => call("POST", `/api/tools/${p.call.id}/release`, { by: OWNER, acknowledged: [...acks] })) }, t("tool_release")),
      el("button", { class: "warn", onclick: () => act(() => call("POST", `/api/tools/${p.call.id}/decline`, { by: OWNER, reason: "declined after review" })) }, t("decline"))));
}

/** On the real sandbox, ask PayPal itself whether each waiting payment was approved by the payer. */
async function checkPayPal() {
  for (const node of document.querySelectorAll(".paypal-live")) {
    try {
      const s = await call("GET", `/api/pending/${node.dataset.key}/paypal`);
      node.textContent = s.stand_in ? t("pp_card") : s.payer_approved ? t("pp_ok") : t("pp_live", { s: paypalStatus(s.status) });
      node.classList.toggle("ok", s.payer_approved);
    } catch (e) { node.textContent = t("pp_unreachable", { e: e.message }); }
  }
}

/** Counts use actual recorded receipt booleans, never AI confidence or inferred provider status. */
function renderProofMetrics(entries) {
  const stats = animaProofLens.counts(entries);
  const widgets = [
    ["proof_total", stats.total, "all"],
    ["proof_yes", stats.moved, "moved"],
    ["proof_no", stats.notMoved, "notMoved"],
    ["proof_fixes", stats.corrected, "corrected"],
  ];
  $("#proof-overview").hidden = stats.total === 0;
  $("#proof-metrics").replaceChildren(...widgets.map(([key, n, scope]) => (
    el("button", { type: "button", class: "proof-metric", "aria-pressed": String(proofScope === scope),
      onclick: () => setProofScope(scope) },
      el("span", { class: "proof-metric-label" }, t(key)), el("strong", {}, String(n)))
  )));
  for (const b of document.querySelectorAll("#proof-scopes button")) b.setAttribute("aria-pressed", String(b.dataset.proofScope === proofScope));
}
function updateProofShown() {
  $("#proof-shown").textContent = t("proof_shown", { n: grid?.getDisplayedRowCount() ?? 0, total: proofTotal });
}
function setProofScope(scope) {
  if (!["all", "moved", "notMoved", "corrected"].includes(scope)) return;
  proofScope = scope;
  if (state) renderGrid(state.receipts, state.tool_receipts || []);
}
function columns() {
  return [
    { field: "time", headerName: t("col_time"), width: 100 },
    { field: "verdict", headerName: t("col_verdict"), width: 140, cellRenderer: (p) => pill(p.value) },
    { field: "status", headerName: t("col_status"), width: 140, valueFormatter: (p) => statusLabel(p.value) },
    { field: "moved", headerName: t("col_moved"), width: 130 },
    { field: "what", headerName: t("col_req"), flex: 2, minWidth: 260 },
    { field: "paypal", headerName: t("col_paypal"), flex: 1, minWidth: 200 },
    { field: "approval", headerName: t("col_approval"), width: 200, valueFormatter: (p) => approvalLabel(p.value) },
    { field: "seams", headerName: t("col_seams"), width: 140, cellRenderer: (p) => (p.value ? el("span", { class: "seam" }, `✦ ${p.value}`) : "") },
  ];
}

/** A tool receipt the simulated tools sealed on a desk otherwise on PayPal's real sandbox (the hosted safety net):
 *  its answer is marked simulated, and it never counts as money moved at PayPal. */
function simulatedAmongReal(r) {
  return isTool(r) && r.provider === "paypal-sandbox-mcp-simulator" && state.mode.paypal === "paypal-sandbox";
}

function movedLabel(r) {
  return !r.money_moved ? t("no") : simulatedAmongReal(r) ? t("moved_sim") : t("yes");
}

function toolRow(r) {
  const res = r.result;
  return {
    id: r.receipt_id, at: r.created_at, time: r.created_at.slice(11, 19), what: toolLine(r.call, r.resolved), verdict: r.verdict, status: r.status,
    moved: movedLabel(r), approval: r.release ? "human_release" : "none",
    paypal: res ? `${simulatedAmongReal(r) ? `${t("sim_tag")} · ` : ""}${[...Object.values(res.ids || {}), toolStatus(res.status || "")].filter(Boolean).join(" · ") || (res.is_error ? statusLabel("FAILED") : "")}` : t("no_call_tool"),
    seams: 0,
  };
}

function renderGrid(receipts, toolReceipts = []) {
  const markers = animaProofLens.entries(receipts, toolReceipts.map((r) => (simulatedAmongReal(r) ? { ...r, money_moved: false } : r)));
  const markerById = new Map(markers.map((x) => [x.id, x]));
  const rows = [...toolReceipts.map((r) => ({ ...toolRow(r), proof: markerById.get(r.receipt_id) })),
    ...receipts.map((r) => ({ at: r.created_at,
      id: r.receipt_id, time: r.created_at.slice(11, 19), what: requestText(r), verdict: r.verdict, status: r.status,
      // Strings, not booleans: AG Grid would otherwise draw checkboxes.
      moved: r.money_moved ? t("yes") : t("no"), approval: r.boundary.approval,
      paypal: r.evidence ? [r.evidence.capture_id || r.evidence.order_id, paypalStatus(r.evidence.capture_status || r.evidence.authorization_status || r.evidence.order_status)].filter(Boolean).join(" · ") : t("no_call"),
      seams: r.corrections.length, proof: markerById.get(r.receipt_id),
    }))].sort((a, b) => (a.at < b.at ? 1 : -1));
  const shown = animaProofLens.select(rows, proofScope);
  proofTotal = rows.length;
  renderProofMetrics(markers);
  if (!grid) {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    $("#grid").classList.add(dark ? "ag-theme-quartz-dark" : "ag-theme-quartz");
    grid = agGrid.createGrid($("#grid"), {
      columnDefs: columns(), rowData: shown, getRowId: (p) => p.data.id, animateRows: true,
      defaultColDef: { sortable: true, resizable: true, filter: true },
      quickFilterText: proofQuery,
      overlayNoRowsTemplate: `<span>${t("no_rows")}</span>`,
      onFilterChanged: updateProofShown,
      onRowClicked: (e) => openDrawer(e.data.id),
    });
  } else {
    grid.setGridOption("columnDefs", columns());
    grid.setGridOption("overlayNoRowsTemplate", `<span>${t("no_rows")}</span>`);
    grid.setGridOption("rowData", shown);
    grid.setGridOption("quickFilterText", proofQuery);
  }
  updateProofShown();
}

function openToolDrawer(r) {
  const source = animaFirewall.factsSource(r, state.mode);
  const dl = (pairs) => el("dl", {}, pairs.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v ?? "—")]));
  const yn = (b) => (b ? t("yes") : t("no"));
  $("#drawer-body").replaceChildren(
    el("div", {}, pill(r.verdict), " ", el("span", { class: "phrase" }, fr() ? I18N.fr.phrase[r.verdict] : r.line)),
    el("pre", { class: "wizard" }, state.wizard.join("\n")),
    el("h3", {}, t("tool_call")),
    dl([[t("tool_tool"), r.call.tool], [t("tool_class"), classLabel(r.klass ?? "null")], [t("tool_agent"), r.call.agent], [t("tool_args"), JSON.stringify(r.call.args)],
      [t("tool_reason", { r: "" }).replace(/\s*:?\s*$/, ""), tx(r.call.reason)]]),
    needsFacts(r.klass) ? el("h3", {}, ts("tool_facts", source)) : "",
    needsFacts(r.klass) ? el("p", {}, factsLine(r.resolved, source)) : "",
    el("h3", {}, t("explanation")),
    el("p", {}, explanationText(r)),
    el("h3", {}, t("asked_ran")),
    dl([[ts("tool_ran", source), r.explanation_code === "TOOL_NOT_SENT_BY_PAYPAL_TOOLS" ? t("tool_not_sent_v") : yn(r.executed)], [t("moved"), movedLabel(r)], [t("tool_released_by"), r.release ? `${r.release.by} · ${r.release.at.slice(0, 16).replace("T", " ")}` : "—"],
      [t("type"), rtypeLabel(r.receipt_type)], [t("mandate"), r.mandate_id]]),
    el("h3", {}, t("findings")),
    r.findings.length ? el("ul", {}, r.findings.map((f) => el("li", {}, findingText(f)))) : el("p", { class: "muted" }, t("none")),
    el("h3", {}, ts("tool_result", source)),
    r.result ? dl([...Object.entries(r.result.ids || {}), ["status", toolStatus(r.result.status || "—")]]) : el("p", { class: "muted" }, t("no_call_tool")),
    r.result?.text ? el("pre", { class: "raw" }, r.result.text) : "");
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
}

function openDrawer(id) {
  const tool = (state.tool_receipts || []).find((x) => x.receipt_id === id);
  if (tool) { openId = id; openToolDrawer(tool); return; }
  const r = state.receipts.find((x) => x.receipt_id === id);
  if (!r) return;
  openId = id;
  const dl = (pairs) => el("dl", {}, pairs.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v ?? "—")]));
  const yn = (b) => (b ? t("yes") : t("no"));
  const canSeal = r.money_moved && r.corrections.length === 0 && /CB-0078/.test(r.requested_action);
  const actual = fr() ? (r.actual_action === "none" ? "rien" : r.actual_action.replace(/^capture /, "encaissement ")) : r.actual_action;
  const evidence = r.evidence ? Object.entries(r.evidence).map(([k, v]) => [fr() ? I18N.fr.evkeys[k] ?? k : k, /_status$/.test(k) ? paypalStatus(String(v)) : String(v)]) : null;
  $("#drawer-body").replaceChildren(
    el("div", {}, pill(r.verdict), " ", el("span", { class: "phrase" }, fr() ? I18N.fr.phrase[r.verdict] : r.line)),
    el("pre", { class: "wizard" }, state.wizard.join("\n")),
    el("h3", {}, t("asked_ran")),
    dl([[t("requested"), requestText(r)], [t("done"), actual], [t("started"), yn(r.execution_started)], [t("moved"), yn(r.money_moved)],
      [t("approval"), approvalLabel(r.boundary.approval)], [t("advisor_row"), advisorLabel(r.advisor)],
      [t("type"), rtypeLabel(r.receipt_type)]]),
    el("h3", {}, t("explanation")),
    el("p", { class: r.corrections.length ? "original" : "" }, explanationText(r)),
    ...r.corrections.map((c) => el("div", { class: "correction" }, el("small", {}, `✦ ${t("seam")} · ${c.by} · ${c.at.slice(0, 16).replace("T", " ")} · ${tx(c.reason)}`), tx(c.replacement))),
    canSeal ? el("button", { class: "ghost", onclick: () => act(() => call("POST", `/api/receipts/${r.receipt_id}/seam`, { by: OWNER }), id) }, t("add_seam")) : "",
    r.deliberation ? el("h3", {}, t("council")) : "",
    councilBlock(r.deliberation),
    el("h3", {}, t("boundary")),
    dl([[t("mandate"), r.boundary.mandate_id], [t("proposal"), r.boundary.proposal_id], [t("idem"), r.boundary.idempotency_key]]),
    el("h3", {}, t("findings")),
    r.findings.length ? el("ul", {}, r.findings.map((f) => el("li", {}, findingText(f)))) : el("p", { class: "muted" }, t("none")),
    el("h3", {}, t("evidence")),
    evidence ? dl(evidence) : el("p", { class: "muted" }, t("no_evidence")),
  );
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() { openId = null; $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); }

function renderAll() {
  renderStatic();
  renderModes(state.mode);
  renderMandate(state.mandate);
  renderScenes(state.scenes);
  renderPending(state.pending, state.tool_pending || []);
  checkPayPal();
  renderTrust(state.trust);
  renderProofs();
  renderGrid(state.receipts, state.tool_receipts || []);
  renderTheatre();
  // The theatre now tells the scene; the old summary card only carries errors.
  if (!lastRun) renderLastRun(); else if (!$("#last-run").dataset.error) $("#last-run").hidden = true;
  if (openId) openDrawer(openId);
  for (const r of [...state.receipts, ...(state.tool_receipts || [])]) knownReceipts.add(r.receipt_id);
  receiptsPrimed = true;
}

let sessionOpen = false;
async function refresh(reopen) {
  // The page opens its session first (hosted: one per visitor; local: nothing to open), then reads its state.
  if (!sessionOpen) { await call("POST", "/api/session", {}); sessionOpen = true; }
  try {
    state = await call("GET", "/api/state");
  } catch (e) {
    // A hosted session that expired: open a new one.
    if (e.status !== 401) throw e;
    await call("POST", "/api/session", {});
    state = await call("GET", "/api/state");
  }
  // The sealed chain: each receipt's place, hash and signature, for its proof object.
  try { sealed = (await call("GET", "/api/ledger")).entries ?? []; } catch { sealed = []; }
  if (reopen) openId = reopen;
  renderAll();
}

/** One action at a time: a double click must not send a second release while the first is in flight. */
let busy = false;
async function act(fn, reopen) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  // Stay locked until the updated state and sealed ledger have been fetched and painted.
  // Unlocking earlier exposes stale pending actions and permits accidental repeat clicks.
  try { await fn(); await refresh(reopen); }
  catch (e) { alertBox(e.message); }
  finally { busy = false; document.body.classList.remove("busy"); }
}

function alertBox(message) {
  const box = $("#last-run");
  box.dataset.error = "1";
  box.replaceChildren(el("h2", {}, t("not_done")), el("p", {}, message));
  box.hidden = false;
}

async function runScene(n) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  delete $("#last-run").dataset.error;
  try {
    lastRun = await call("POST", `/api/scenes/${n}`);
    ranScenes.add(n);
    playNext = true;
    await refresh();
    $("#theatre").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  } catch (e) { alertBox(e.message); }
  finally { busy = false; document.body.classList.remove("busy"); }
}

function setLang(next) {
  lang = next;
  try { localStorage.setItem("anima.lang", next); } catch { /* storage may be blocked */ }
  if (state) renderAll(); else renderStatic();
}

for (const b of document.querySelectorAll("#lang button")) b.addEventListener("click", () => setLang(b.dataset.lang));
for (const b of document.querySelectorAll("#proof-scopes button")) b.addEventListener("click", () => setProofScope(b.dataset.proofScope));
$("#proof-search").addEventListener("input", (e) => {
  proofQuery = e.target.value;
  if (grid) { grid.setGridOption("quickFilterText", proofQuery); updateProofShown(); }
});
$("#reset").addEventListener("click", () => {
  lastRun = null; proofScope = "all"; proofQuery = ""; proofAutoOpened = false;
  $("#proof-search").value = ""; $("#forensic").open = false;
  act(() => call("POST", "/api/reset"));
});
$("#drawer-close").addEventListener("click", closeDrawer);
$("#run-first").addEventListener("click", () => runScene(1));
$("#run-poison").addEventListener("click", () => runScene(3));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
// Back from PayPal: PayPal appends ?paypal=return&token=<order>; the desk asks PayPal itself, so the
// address bar is only cleaned, never trusted.
if (new URLSearchParams(location.search).has("paypal")) history.replaceState(null, "", location.pathname);
window.addEventListener("focus", () => { if (state) checkPayPal(); });
renderStatic();
refresh();
