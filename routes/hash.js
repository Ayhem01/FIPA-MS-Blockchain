const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

router.get('/:txHash', async (req, res) => {
  try {
    const { txHash } = req.params;

    if (!web3Service.web3) await web3Service.initialize();

    const tx = await web3Service.web3.eth.getTransaction(txHash);
    if (!tx) {
      return res.status(404).json({ success: false, error: 'Transaction non trouvée' });
    }

    const receipt = await web3Service.web3.eth.getTransactionReceipt(txHash);

    // --- Décodage de la fonction appelée ---
    const decodedInput = web3Service.decodeTxInput(tx.input);

    let inviterData = null;

    // --- Si la transaction concerne un inviter ---
    if (
      decodedInput?.method &&
      ['addInviter', 'acceptInvitation', 'rejectInvitation', 'convertInviterToProspect'].includes(decodedInput.method)
    ) {
      const inviterId = decodedInput.args?._inviterId || decodedInput.args?.inviterId;

      if (inviterId !== undefined) {
        try {
          // 🔹 Appel au smart contract pour récupérer les données
          const inviter = await web3Service.callMethod('inviters', [inviterId]);

          // 🔹 Reformatage pour correspondre à la structure du backend
          inviterData = {
            id: inviterId,
            entreprise_id: inviter.entrepriseId?.toString?.() ?? '',
            action_id: inviter.actionId?.toString?.() ?? '',
            nom: inviter.nom || '',
            prenom: inviter.prenom || '',
            email: inviter.email || '',
            type_invite: inviter.typeInvit || '',
            proprietaire_id: inviter.proprietaireId?.toString?.() ?? '',
            pipeline_stage_id: inviter.pipelineStageId?.toString?.() ?? '',
            status: inviter.status || '',
            invitedAt: inviter.invitedAt?.toString?.() ?? '',
            respondedAt: inviter.respondedAt?.toString?.() ?? '',
            isConvertedToProspect: !!inviter.isConvertedToProspect,
            prospectId: inviter.prospectId?.toString?.() ?? '0',
            pipeline_stage: {
              id: inviter.pipelineStageId?.toString?.() ?? '',
              name: inviter.stageName || 'Invitation en attente',
              description: inviter.stageDescription || 'Invitation en attente',
              order: inviter.stageOrder || 1,
              is_final: inviter.stageIsFinal || false,
              color: inviter.stageColor || '#4A90E2',
              status: inviter.stageStatus || 'open',
              is_active: inviter.stageActive ?? true,
            },
            pipeline_progressions: [
              {
                id: inviter.progressionId?.toString?.() ?? '',
                invite_id: inviterId,
                stage_id: inviter.pipelineStageId?.toString?.() ?? '',
                completed: !!inviter.completed,
                completed_at: inviter.completedAt?.toString?.() ?? null,
                notes: inviter.notes || null,
                assigned_to: inviter.assignedTo?.toString?.() ?? '',
              },
            ],
          };
        } catch (err) {
          console.warn('Impossible de récupérer les données inviter depuis la blockchain:', err.message);
        }
      }
    }

    // --- Réponse finale ---
    res.json({
      success: true,
      data: {
        tx,
        receipt,
        decodedInput,
        decodedEvents: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
        })),
        inviterData,
      },
    });
  } catch (error) {
    console.error('Erreur de lookup transaction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
