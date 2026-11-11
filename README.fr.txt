Vous rechargez votre voiture de société à domicile avec STROOHM ? Cette app affiche directement dans Homey combien vous avez rechargé et combien votre employeur vous rembourse : ce mois-ci, cette année et depuis le début. Fini les exports refaits dans Excel.

CE QUE VOUS OBTENEZ
- kWh rechargés à domicile : ce mois-ci, le mois dernier, cette année et au total
- Remboursement exact dû ce mois-ci, tel que facturé à votre employeur, et une projection sur le mois complet
- Remboursement en attente (le mois en cours, versé par Monta le 1er) et total remboursé
- Taux de remboursement actuel
- Votre gain ou perte réel : remboursement moins votre coût d'électricité, par mois, par année et au total
- Recharges publiques et au bureau payées par la carte de la société : kWh et montant, et la part rechargée à domicile
- Chaque valeur peut servir d'indicateur d'état de l'appareil et garde tout son historique dans Insights

COÛT DE L'ÉLECTRICITÉ
Utilisez le tarif encodé dans l'app STROOHM, un prix fixe ou un tarif jour/nuit (bihoraire). En jour/nuit, l'app tarifie chaque kWh à l'heure où il a vraiment été rechargé (données horaires de Monta), ou applique la moyenne de votre choix : toujours la nuit, 50/50, toujours en journée, ou votre propre répartition.

AVANT MONTA
Si vous étiez remboursé via une autre plateforme avant Monta, encodez ce que vous avez reçu par mois ou par année, et si vous les connaissez les kWh rechargés à domicile et vos recharges publiques. Les totaux, le gain/perte et la part maison couvrent alors tout votre historique.

FLOWS
Quand : une recharge à domicile est terminée, une recharge publique est terminée, un mois est clôturé, le taux de remboursement a changé, un rapport mensuel est prêt.
Et : remboursement en attente supérieur à un montant, le résultat du mois est négatif.
Alors : actualiser maintenant, générer un rapport mensuel (résumé + CSV).

RAPPORT MENSUEL
Les réglages de l'app affichent un tableau mois par mois et l'exportent en CSV pour Excel ou Google Sheets.

PRÉREQUIS
- Un compte conducteur STROOHM avec une borne à domicile (STROOHM repose sur la plateforme Monta).
- Des identifiants API (Client ID + Client secret), créés sur platform.stroohm.com. L'écran d'ajout de l'appareil explique les étapes.

VIE PRIVÉE
Vos données restent sur votre Homey et ne sont échangées qu'avec l'API Monta. Rien n'est envoyé au développeur.

L'app ne pilote pas votre borne et n'ajoute rien à Homey Énergie : votre consommation n'est jamais comptée deux fois.

App communautaire, non affiliée à STROOHM ni à Monta, qui ne la soutiennent pas officiellement.
