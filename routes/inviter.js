const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// Security: API key for non-GET requests
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const expected = process.env.API_KEY;
  if (!expected) return next(); // skip if not configured
  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized: invalid API key' });
  }
  next();
});

// Helpers
const toUint = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
};
const mapInviterStatus = (input) => {
  const s = String(input).toLowerCase();
  if (s === '0' || s === 'pending') return 0;
  if (s === '1' || s === 'accepted') return 1;
  if (s === '2' || s === 'rejected') return 2;
  return null;
};
const statusToString = (n) => {
  const i = Number(n);
  return i === 1 ? 'Accepted' : i === 2 ? 'Rejected' : 'Pending';
};
async function ensureContractReady() {
  if (!web3Service.web3) await web3Service.initialize();
  if (!web3Service.contract) await web3Service.loadContract();
}
async function getAccountFromPk(pkRaw) {
  const pk = (pkRaw || '').trim();
  const hex = pk.startsWith('0x') ? pk : `0x${pk}`;
  return web3Service.web3.eth.accounts.privateKeyToAccount(hex);
}
async function ensureOwnerAccount(account) {
  try {
    const owner = await web3Service.callMethod('owner', []);
    if (String(owner).toLowerCase() !== account.address.toLowerCase()) {
      const err = new Error('Only contract owner can call this function');
      err.details = { contractOwner: owner, sender: account.address };
      throw err;
    }
  } catch {
    // let contract enforce onlyOwner if owner() not available
  }
}
async function tryGetInviter(id) {
  try {
    const inv = await web3Service.callMethod('inviters', [id]);
    if (inv && inv.invitedAt && BigInt(inv.invitedAt) > 0n) return inv;
  } catch {}
  return null;
}
// Scan a public array by index until out-of-bounds (revert) or limit reached
async function listArrayByIndex(varName, from = 0, limit = 50) {
  const ids = [];
  let i = Number(from) || 0;
  const end = i + (Number(limit) || 50);
  for (; i < end; i++) {
    try {
      const id = await web3Service.callMethod(varName, [i]);
      if (id == null) break;
      // Some chains may return "0" for empty slots; keep consistent with push/pop behavior (array is packed)
      ids.push(String(id));
    } catch {
      break; // out-of-bounds
    }
  }
  return ids;
}

// Ping
router.all('/ping', (_req, res) => {
  res.json({ success: true, route: 'inviter', ping: 'ok' });
});

// Diagnostics
router.get('/', (_req, res) => {
  res.json({
    success: true,
    route: 'inviter',
    endpoints: [
      'POST     /api/inviter/add',
      'POST     /api/inviter/:inviterId/send',
      'PUT      /api/inviter/:inviterId',
      'DELETE   /api/inviter/:inviterId',
      'POST     /api/inviter/:inviterId/accept',
      'POST     /api/inviter/:inviterId/reject',
      'POST     /api/inviter/:inviterId/convert',
      'GET      /api/inviter/:inviterId/status',
      'GET      /api/inviter/:inviterId',
      'POST     /api/inviter/:inviterId/convert'

    ]
  });
});

// Disallow GET /add
router.get('/add', (_req, res) => {
  res.status(405).json({ success: false, error: 'Use POST /api/inviter/add' });
});

// Add inviter (onlyOwner)
router.post('/add', async (req, res) => {
  try {
    const {
      nom = '',
      prenom = '',
      email = '',
      telephone = '',
      privateKey
    } = req.body || {};

    const pk = (privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (!nom) return res.status(400).json({ success: false, error: 'nom is required' });
    if (!prenom) return res.status(400).json({ success: false, error: 'prenom is required' });
    if (!email) return res.status(400).json({ success: false, error: 'email is required' });
    if (!telephone) return res.status(400).json({ success: false, error: 'telephone is required' });
    if (!pk) return res.status(400).json({ success: false, error: 'privateKey is required' });

    await ensureContractReady();
    const account = await getAccountFromPk(pk);
    await ensureOwnerAccount(account);

    // Simulation
    try {
      await web3Service.contract.methods
        .addInviter(nom, prenom, email, telephone)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `Revert (simulation): ${e?.message || 'call failed'}`
      });
    }

    const receipt = await web3Service.sendTransaction(
      'addInviter',
      [nom, prenom, email, telephone],
      null,
      pk
    );

    let inviterId;
    if (receipt.events?.InviterCreated?.returnValues?.id) {
      inviterId = receipt.events.InviterCreated.returnValues.id.toString();
    }

    res.json({
      success: true,
      data: {
        inviterId,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send invitation (onlyOwner)
router.post('/:inviterId/send', async (req, res) => {
  try {
    const idNum = toUint(req.params.inviterId);
    const pk = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'inviterId must be numeric' });
    if (!pk) return res.status(400).json({ success: false, error: 'privateKey is required' });

    await ensureContractReady();
    const account = await getAccountFromPk(pk);
    await ensureOwnerAccount(account);

    const inv = await tryGetInviter(idNum);
    if (!inv) return res.status(404).json({ success: false, error: 'Inviter not found' });

    try {
      await web3Service.contract.methods.sendInvitation(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('sendInvitation', [idNum], null, pk);
    res.json({ success: true, data: { inviterId: String(idNum), transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});

// Update inviter (onlyOwner)
router.put('/:inviterId', async (req, res) => {
  try {
    const idNum = toUint(req.params.inviterId);
    const {
      nom = '', prenom = '', email = '', telephone = '',
      status, privateKey
    } = req.body || {};

    const statusNum = mapInviterStatus(status);
    const pk = (privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (idNum === null) return res.status(400).json({ success: false, error: 'inviterId must be numeric' });
    if (!nom) return res.status(400).json({ success: false, error: 'nom is required' });
    if (!prenom) return res.status(400).json({ success: false, error: 'prenom is required' });
    if (!email) return res.status(400).json({ success: false, error: 'email is required' });
    if (!telephone) return res.status(400).json({ success: false, error: 'telephone is required' });
    if (statusNum === null) return res.status(400).json({ success: false, error: 'status must be 0|1|2 or Pending|Accepted|Rejected' });
    if (!pk) return res.status(400).json({ success: false, error: 'privateKey is required' });

    await ensureContractReady();
    const account = await getAccountFromPk(pk);
    await ensureOwnerAccount(account);

    const inv = await tryGetInviter(idNum);
    if (!inv) return res.status(404).json({ success: false, error: 'Inviter not found' });

    // Simulation with new signature
    try {
      await web3Service.contract.methods
        .updateInviter(idNum, nom, prenom, email, telephone, statusNum)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'updateInviter',
      [idNum, nom, prenom, email, telephone, statusNum],
      null,
      pk
    );

    res.json({
      success: true,
      data: {
        inviterId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});

// Delete inviter (onlyOwner)
router.delete('/:inviterId', async (req, res) => {
  try {
    const idNum = toUint(req.params.inviterId);
    const pk = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'inviterId must be numeric' });
    if (!pk) return res.status(400).json({ success: false, error: 'privateKey is required' });

    await ensureContractReady();
    const account = await getAccountFromPk(pk);
    await ensureOwnerAccount(account);

    const inv = await tryGetInviter(idNum);
    if (!inv) return res.status(404).json({ success: false, error: 'Inviter not found' });

    try {
      await web3Service.contract.methods.deleteInviter(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('deleteInviter', [idNum], null, pk);
    res.json({ success: true, data: { inviterId: String(idNum), transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});

// Accept invitation (public)
router.post('/:inviterId/accept', async (req, res) => {
  try {
    const idNum = toUint(req.params.inviterId);
    const pk = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'inviterId must be numeric' });
    if (!pk) return res.status(400).json({ success: false, error: 'privateKey is required' });

    await ensureContractReady();
    const account = await getAccountFromPk(pk);

    const inv = await tryGetInviter(idNum);
    if (!inv) return res.status(404).json({ success: false, error: 'Inviter not found' });

    try {
      await web3Service.contract.methods.acceptInvitation(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('acceptInvitation', [idNum], null, pk);
    res.json({ success: true, data: { inviterId: String(idNum), transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reject invitation (public)
router.post('/:inviterId/reject', async (req, res) => {
  try {
    const idNum = toUint(req.params.inviterId);
    const pk = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'inviterId must be numeric' });
    if (!pk) return res.status(400).json({ success: false, error: 'privateKey is required' });

    await ensureContractReady();
    const account = await getAccountFromPk(pk);

    const inv = await tryGetInviter(idNum);
    if (!inv) return res.status(404).json({ success: false, error: 'Inviter not found' });

    try {
      await web3Service.contract.methods.rejectInvitation(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('rejectInvitation', [idNum], null, pk);
    res.json({ success: true, data: { inviterId: String(idNum), transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


router.post('/:inviterId/convert', async (req, res) => {
  try {
    const idNum = toUint(req.params.inviterId);
    const {
      nom = '',
      adresse = '',
      valeurPotentielle,
      valeur_potentielle,
      notesInternes = '',
      notes_internes = '',
      privateKey
    } = req.body || {};

    const pk = (privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'inviterId must be numeric' });
    if (!pk) return res.status(400).json({ success: false, error: 'privateKey is required' });

    const valeur = toUint(valeurPotentielle ?? valeur_potentielle ?? 0);
    if (valeur === null) return res.status(400).json({ success: false, error: 'valeurPotentielle invalide' });

    await ensureContractReady();
    const account = await getAccountFromPk(pk);
    await ensureOwnerAccount(account);

    const inv = await tryGetInviter(idNum);
    if (!inv) return res.status(404).json({ success: false, error: 'Inviter not found' });
    if (inv.converted) return res.status(400).json({ success: false, error: 'Already converted' });

    // Simulation
    try {
      await web3Service.contract.methods
        .convertInviterToProspect(idNum, nom, adresse, valeur, notesInternes || notes_internes)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}`
      });
    }

    const receipt = await web3Service.sendTransaction(
      'convertInviterToProspect',
      [idNum, nom, adresse, valeur, notesInternes || notes_internes],
      null,
      pk
    );

    let prospectId = null;
    if (receipt.events?.ProspectCreated?.returnValues?.id) {
      prospectId = receipt.events.ProspectCreated.returnValues.id.toString();
    } else if (receipt.events?.InviterConverted?.returnValues?.prospectId) {
      prospectId = receipt.events.InviterConverted.returnValues.prospectId.toString();
    } else if (receipt.events?.InviterConverted?.returnValues?.['1']) {
      prospectId = receipt.events.InviterConverted.returnValues['1'].toString();
    }

    res.json({
      success: true,
      data: {
        inviterId: String(idNum),
        prospectId,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});


router.get('/:inviterId/status', async (req, res) => {
  try {
    const idNum = toUint(req.params.inviterId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'inviterId must be numeric' });
    await ensureContractReady();

    const inv = await tryGetInviter(idNum);
    if (!inv) return res.status(404).json({ success: false, error: 'Inviter not found' });

    const statusNum = inv.status?.toString?.() ?? '0';
    res.json({
      success: true,
      data: {
        inviterId: String(idNum),
        status: statusNum,
        statusLabel: statusToString(statusNum),
        invitedAt: inv.invitedAt?.toString?.() ?? '',
        respondedAt: inv.respondedAt?.toString?.() ?? ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get inviter (struct)
router.get('/:inviterId', async (req, res) => {
  try {
    const idNum = toUint(req.params.inviterId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'inviterId must be numeric' });

    await ensureContractReady();
    const inv = await tryGetInviter(idNum);
    if (!inv) return res.status(404).json({ success: false, error: 'Inviter not found' });

    res.json({
      success: true,
      data: {
        id: inv.id?.toString?.() ?? String(idNum),
        status: inv.status?.toString?.() ?? '0',
        statusLabel: statusToString(inv.status),
        invitedAt: inv.invitedAt?.toString?.() ?? '',
        respondedAt: inv.respondedAt?.toString?.() ?? '',
        isConvertedToProspect: !!inv.isConvertedToProspect,
        prospectId: inv.prospectId?.toString?.() ?? '0',
        nom: inv.nom,
        prenom: inv.prenom,
        email: inv.email,
        telephone: inv.telephone,
        pays_id: inv.pays_id?.toString?.() ?? '0',
        secteur_id: inv.secteur_id?.toString?.() ?? '0'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;