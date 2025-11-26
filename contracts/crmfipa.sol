// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract crmfipa {
    address public owner;

    enum InviterStatus { Pending, Accepted, Rejected }
    enum ProspectStatus { Nouveau, EnCours, Qualifie, NonQualifie, Converti, Perdu }
    enum InvestisseurStatus { Actif, Negociation, Engagement, Finalisation, Investi, Suspendu, Inactif }
    enum ProjetStatus { Planned, InProgress, Completed, Abandoned, Suspended, OnHold }
    enum TaskStatus { NotStarted, InProgress, Completed, Deferred, Waiting }
    enum ActionStatus { Planned, Executed, Canceled }

    struct Inviter {
        uint256 id;
        InviterStatus status;
        uint256 invitedAt;
        uint256 respondedAt;
        bool converted;
        uint256 prospectId;
        string nom;
        string prenom;
        string email;
        string telephone;
    }

  struct Prospect {
    uint256 id;
    uint256 inviterId;
    string nom;
    string adresse;
    uint256 valeur_potentielle;
    string notes_internes;

    ProspectStatus status;
    uint256 createdAt;
    uint256 convertedAt;
    uint256 investisseurId;
}


  struct Investisseur {
    uint256 id;
    string nom;
    uint256 prospect_id;
    uint256 montant_investissement;
    string interets_specifiques;
    string criteres_investissement;
    InvestisseurStatus status;
    uint256 createdAt;
    address createdBy;
}

   struct Projet {
    uint256 id;
    string company_name;
    string market_target;
    uint256 investment_amount;
    uint256 jobs_expected;
    string industrial_zone;
    uint256 investisseurId;
    ProjetStatus status;
    uint256 createdAt;
    address createdBy;
}


   struct Blocage {
        uint256 id;
        string name;
        string description;
        string status;
        uint8 priority;            
        uint256 assignedTo;        
        uint256 resolvedBy;        
        bool isBlocking;
        uint256 relatedEntityId;
        string relatedEntityType;  
    }

    struct Task {
        uint256 id;
        string title;
        string description;
        TaskStatus status;
        uint256 entityId;
        string entityType; // "prospect","investisseur","projet","inviter"
        uint256 createdAt;
        uint256 createdBy;
    }
   struct Action {
    uint256 id;
    string nom;
    string description;
    string typeAction;
    uint256 dateDebut;
    string ville;
    ActionStatus statut;
    uint256 responsableId;
    uint256 createdAt;
    address createdBy;
}


    mapping(uint256 => Inviter) public inviters;
    mapping(uint256 => Prospect) public prospects;
    mapping(uint256 => Investisseur) public investisseurs;
    mapping(uint256 => Projet) public projets;
    mapping(uint256 => Blocage) public blocages;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => Action) public actions;

    uint256[] public inviterIds;
    uint256[] public prospectIds;
    uint256[] public investisseurIds;
    uint256[] public projetIds;
    uint256[] public blocageIds;
    uint256[] public taskIds;
    uint256[] public actionIds;

    uint256 public nextInviterId = 1;
    uint256 public nextProspectId = 1;
    uint256 public nextInvestisseurId = 1;
    uint256 public nextProjetId = 1;
    uint256 public nextBlocageId = 1;
    uint256 public nextTaskId = 1;
    uint256 public nextActionId = 1;

    event InviterCreated(uint256 indexed id);
    event InvitationSent(uint256 indexed id);
    event InvitationAccepted(uint256 indexed id);
    event InvitationRejected(uint256 indexed id);
    event InviterConverted(uint256 indexed inviterId, uint256 prospectId);
    event InviterUpdated(uint256 indexed id);
    event InviterDeleted(uint256 indexed id);

    event ProspectCreated(uint256 indexed id);
    event ProspectUpdated(uint256 indexed id);
    event ProspectDeleted(uint256 indexed id);
    event ProspectConverted(uint256 indexed prospectId, uint256 investisseurId);
    event ProspectStatusUpdated(uint256 indexed prospectId, ProspectStatus status);

    event InvestisseurCreated(uint256 indexed id);
    event InvestisseurUpdated(uint256 indexed id);
    event InvestisseurDeleted(uint256 indexed id);
    event InvestisseurConverted(uint256 indexed investisseurId, uint256 projetId);
    event InvestisseurStatusUpdated(uint256 indexed id, InvestisseurStatus status);

    event ProjetCreated(uint256 indexed id);
    event ProjetUpdated(uint256 indexed id);
    event ProjetDeleted(uint256 indexed id);
    event ProjetStatusUpdated(uint256 indexed id, ProjetStatus status);

    event BlocageCreated(uint256 indexed id);
    event BlocageUpdated(uint256 indexed id);
    event BlocageEscalated(uint256 indexed id, uint256 indexed to);
    event BlocageResolved(uint256 indexed id, uint256 indexed by);
    event BlocageDeleted(uint256 indexed id);

    event TaskCreated(uint256 indexed id);
    event TaskUpdated(uint256 indexed id);
    event TaskDeleted(uint256 indexed id);

    event ActionCreated(uint256 indexed id);
    event ActionUpdated(uint256 indexed id);
    event ActionDeleted(uint256 indexed id);
    event ActionStatusUpdated(uint256 indexed id, ActionStatus status);    

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addInviter(
        string memory _nom,
        string memory _prenom,
        string memory _email,
        string memory _telephone
    ) public onlyOwner returns (uint256) {
        uint256 id = nextInviterId++;
        inviters[id] = Inviter({
            id: id,
            status: InviterStatus.Pending,
            invitedAt: block.timestamp,
            respondedAt: 0,
            converted: false,
            prospectId: 0,
            nom: _nom,
            prenom: _prenom,
            email: _email,
            telephone: _telephone
        });
        inviterIds.push(id);
        emit InviterCreated(id);
        emit InvitationSent(id);
        return id;
    }

    function sendInvitation(uint256 _id) public onlyOwner {
        require(inviters[_id].invitedAt != 0, "Not found");
        inviters[_id].invitedAt = block.timestamp;
        inviters[_id].status = InviterStatus.Pending;
        emit InvitationSent(_id);
    }
    // kept public like original (user/recipient can accept/reject)
    function acceptInvitation(uint256 _id) public {
        require(inviters[_id].invitedAt != 0, "Not found");
        require(inviters[_id].status == InviterStatus.Pending, "Not pending");
        inviters[_id].status = InviterStatus.Accepted;
        inviters[_id].respondedAt = block.timestamp;
        emit InvitationAccepted(_id);
    }

    function rejectInvitation(uint256 _id) public {
        require(inviters[_id].invitedAt != 0, "Not found");
        require(inviters[_id].status == InviterStatus.Pending, "Not pending");
        inviters[_id].status = InviterStatus.Rejected;
        inviters[_id].respondedAt = block.timestamp;
        emit InvitationRejected(_id);
    }

    function updateInviter(
        uint256 _id,
        string memory _nom,
        string memory _prenom,
        string memory _email,
        string memory _telephone,
        InviterStatus _status
    ) public onlyOwner {
        require(inviters[_id].invitedAt != 0, "Not found");
        InvitersLib_updateInviterFields(_id, _nom, _prenom, _email, _telephone, _status);
        emit InviterUpdated(_id);
    }

    // small internal helper to reduce code duplication
    function InvitersLib_updateInviterFields(
        uint256 _id,
        string memory _nom,
        string memory _prenom,
        string memory _email,
        string memory _telephone,
        InviterStatus _status
    ) internal {
        Inviter storage inv = inviters[_id];
        inv.nom = _nom;
        inv.prenom = _prenom;
        inv.email = _email;
        inv.telephone = _telephone;
        inv.status = _status;
    }

    function deleteInviter(uint256 _id) public onlyOwner {
        require(inviters[_id].invitedAt != 0, "Not found");
        if (inviters[_id].converted) {
            uint256 p = inviters[_id].prospectId;
            if (p != 0 && prospects[p].id != 0) {
                prospects[p].inviterId = 0;
            }
        }
        _removeFromArray(inviterIds, _id);
        delete inviters[_id];
        emit InviterDeleted(_id);
    }

   function convertInviterToProspect(
    uint256 _inviterId,
    string memory _nom,
    string memory _adresse,
    uint256 _valeurPotentielle,
    string memory _notesInternes
) public onlyOwner returns (uint256) {
    require(inviters[_inviterId].invitedAt != 0, "Inviter not found");
    require(!inviters[_inviterId].converted, "Already converted");

    uint256 pid = nextProspectId++;

    // Si _nom n’est pas fourni, reprendre le nom de l’inviter
    string memory finalNom = bytes(_nom).length == 0
        ? inviters[_inviterId].nom
        : _nom;

    prospects[pid] = Prospect({
        id: pid,
        inviterId: _inviterId,
        nom: finalNom,
        adresse: _adresse,
        valeur_potentielle: _valeurPotentielle,
        notes_internes: _notesInternes,
        status: ProspectStatus.Nouveau,
        createdAt: block.timestamp,
        convertedAt: 0,
        investisseurId: 0
    });

    prospectIds.push(pid);

    inviters[_inviterId].converted = true;
    inviters[_inviterId].prospectId = pid;

    emit ProspectCreated(pid);
    emit InviterConverted(_inviterId, pid);

    return pid;
}


   function createProspect(
    string memory _nom,
    string memory _adresse,
    uint256 _valeurPotentielle,
    string memory _notesInternes
) public onlyOwner returns (uint256) {

    uint256 id = nextProspectId++;

    prospects[id] = Prospect({
        id: id,
        inviterId: 0,
        nom: _nom,
        adresse: _adresse,
        valeur_potentielle: _valeurPotentielle,
        notes_internes: _notesInternes,
        status: ProspectStatus.Nouveau,
        createdAt: block.timestamp,
        convertedAt: 0,
        investisseurId: 0
    });

    prospectIds.push(id);

    emit ProspectCreated(id);

    return id;
}


   function updateProspect(
    uint256 _id,
    string memory _nom,
    string memory _adresse,
    uint256 _valeurPotentielle,
    string memory _notesInternes,
    ProspectStatus _status
) public onlyOwner {
    require(prospects[_id].id != 0, "Prospect not found");

    Prospect storage p = prospects[_id];

    p.nom = _nom;
    p.adresse = _adresse;
    p.valeur_potentielle = _valeurPotentielle;
    p.notes_internes = _notesInternes;
    p.status = _status;

    emit ProspectUpdated(_id);
    emit ProspectStatusUpdated(_id, _status);
}


    function updateProspectStatus(uint256 _id, ProspectStatus _status) public onlyOwner {
        require(prospects[_id].id != 0, "Prospect not found");
        prospects[_id].status = _status;
        emit ProspectStatusUpdated(_id, _status);
    }

    function deleteProspect(uint256 _id) public onlyOwner {
        require(prospects[_id].id != 0, "Prospect not found");
        uint256 inv = prospects[_id].inviterId;
        if (inv != 0 && inviters[inv].id != 0) {
            inviters[inv].converted = false;
            inviters[inv].prospectId = 0;
        }
        _removeFromArray(prospectIds, _id);
        delete prospects[_id];
        emit ProspectDeleted(_id);
    }

    function convertProspectToInvestisseur(
    uint256 _prospectId,
    string memory _nom,
    uint256 _montantInvestissement,
    string memory _interetsSpecifiques,
    string memory _criteresInvestissement,
    InvestisseurStatus _status
) public onlyOwner returns (uint256) {
    require(prospects[_prospectId].id != 0, "Prospect not found");

    uint256 id = nextInvestisseurId++;

    investisseurs[id] = Investisseur({
        id: id,
        nom: _nom,
        prospect_id: _prospectId,
        montant_investissement: _montantInvestissement,
        interets_specifiques: _interetsSpecifiques,
        criteres_investissement: _criteresInvestissement,
        status: _status,
        createdAt: block.timestamp,
        createdBy: msg.sender
    });

    investisseurIds.push(id);

    // Mise à jour du prospect
    prospects[_prospectId].investisseurId = id;
    prospects[_prospectId].status = ProspectStatus.Converti;
    prospects[_prospectId].convertedAt = block.timestamp;

    emit InvestisseurCreated(id);
    emit ProspectConverted(_prospectId, id);

    return id;
}


   function createInvestisseur(
    string memory _nom,
    uint256 _prospectId,
    uint256 _montantInvestissement,
    string memory _interetsSpecifiques,
    string memory _criteresInvestissement,
    InvestisseurStatus _status
) public onlyOwner returns (uint256) {
    uint256 id = nextInvestisseurId++;

    investisseurs[id] = Investisseur({
        id: id,
        nom: _nom,
        prospect_id: _prospectId,
        montant_investissement: _montantInvestissement,
        interets_specifiques: _interetsSpecifiques,
        criteres_investissement: _criteresInvestissement,
        status: _status,
        createdAt: block.timestamp,
        createdBy: msg.sender
    });

    investisseurIds.push(id);

    if (_prospectId != 0 && prospects[_prospectId].id != 0) {
        prospects[_prospectId].investisseurId = id;
    }

    emit InvestisseurCreated(id);
    return id;
}


  function updateInvestisseur(
    uint256 _id,
    string memory _nom,
    uint256 _montantInvestissement,
    string memory _interetsSpecifiques,
    string memory _criteresInvestissement,
    InvestisseurStatus _status
) public onlyOwner {
    require(investisseurs[_id].id != 0, "Investisseur not found");

    Investisseur storage inv = investisseurs[_id];

    inv.nom = _nom;
    inv.montant_investissement = _montantInvestissement;
    inv.interets_specifiques = _interetsSpecifiques;
    inv.criteres_investissement = _criteresInvestissement;
    inv.status = _status;

    emit InvestisseurUpdated(_id);
    emit InvestisseurStatusUpdated(_id, _status);
}
function updateInvestisseurStatus(
        uint256 _id,
        InvestisseurStatus _status
    ) public onlyOwner {
        require(investisseurs[_id].id != 0, "Investisseur not found");
        investisseurs[_id].status = _status;
        emit InvestisseurStatusUpdated(_id, _status);
    }

   function deleteInvestisseur(uint256 _id) public onlyOwner {
    require(investisseurs[_id].id != 0, "Investisseur not found");

    uint256 pid = investisseurs[_id].prospect_id;

    if (pid != 0 && prospects[pid].id != 0) {
        prospects[pid].investisseurId = 0;
    }

    _removeFromArray(investisseurIds, _id);
    delete investisseurs[_id];

    emit InvestisseurDeleted(_id);
}


   function convertInvestisseurToProjet(
    uint256 _investisseurId,
    string memory _companyName,
    string memory _marketTarget,
    uint256 _investmentAmount,
    uint256 _jobsExpected,
    string memory _industrialZone,
    ProjetStatus _status
) public onlyOwner returns (uint256) {
    require(investisseurs[_investisseurId].id != 0, "Investisseur not found");

    uint256 id = nextProjetId++;

    projets[id] = Projet({
        id: id,
        company_name: _companyName,
        market_target: _marketTarget,
        investment_amount: _investmentAmount,
        jobs_expected: _jobsExpected,
        industrial_zone: _industrialZone,
        investisseurId: _investisseurId,
        status: _status,
        createdAt: block.timestamp,
        createdBy: msg.sender
    });

    projetIds.push(id);

    emit ProjetCreated(id);
    emit InvestisseurConverted(_investisseurId, id);

    return id;
}


  function createProjet(
    string memory _companyName,
    string memory _marketTarget,
    uint256 _investmentAmount,
    uint256 _jobsExpected,
    string memory _industrialZone,
    uint256 _investisseurId,
    ProjetStatus _status
) public onlyOwner returns (uint256) {
    uint256 id = nextProjetId++;

    projets[id] = Projet({
        id: id,
        company_name: _companyName,
        market_target: _marketTarget,
        investment_amount: _investmentAmount,
        jobs_expected: _jobsExpected,
        industrial_zone: _industrialZone,
        investisseurId: _investisseurId,
        status: _status,
        createdAt: block.timestamp,
        createdBy: msg.sender
    });

    projetIds.push(id);

    emit ProjetCreated(id);
    return id;
}


   function updateProjet(
    uint256 _id,
    string memory _companyName,
    string memory _marketTarget,
    uint256 _investmentAmount,
    uint256 _jobsExpected,
    string memory _industrialZone,
    ProjetStatus _status
) public onlyOwner {
    require(projets[_id].id != 0, "Projet not found");

    Projet storage p = projets[_id];

    p.company_name = _companyName;
    p.market_target = _marketTarget;
    p.investment_amount = _investmentAmount;
    p.jobs_expected = _jobsExpected;
    p.industrial_zone = _industrialZone;
    p.status = _status;

    emit ProjetUpdated(_id);
    emit ProjetStatusUpdated(_id, _status);
}


   function deleteProjet(uint256 _id) public onlyOwner {
    require(projets[_id].id != 0, "Projet not found");
    _removeFromArray(projetIds, _id);
    delete projets[_id];
    emit ProjetDeleted(_id);
}
function updateProjetStatus(
    uint256 _id,
    ProjetStatus _status
) public onlyOwner {
    require(projets[_id].id != 0, "Projet not found");

    projets[_id].status = _status;

    emit ProjetStatusUpdated(_id, _status);
}


   function createBlocage(
        string memory _name,
        string memory _description,
        string memory _status,
        uint8 _priority,
        bool _isBlocking,
        uint256 _relatedEntityId,
        string memory _relatedEntityType,
        uint256 _assignedTo
    ) public onlyOwner returns (uint256) {
        uint256 id = ++nextBlocageId;
        blocages[id] = Blocage({
            id: id,
            name: _name,
            description: _description,
            status: _status,
            priority: _priority,
            assignedTo: _assignedTo,
            resolvedBy: 0,
            isBlocking: _isBlocking,
            relatedEntityId: _relatedEntityId,
            relatedEntityType: _relatedEntityType
        });
        blocageIds.push(id);
        emit BlocageCreated(id);
        return id;
    }

   function updateBlocage(
        uint256 _id,
        string memory _name,
        string memory _description,
        string memory _status,
        uint8 _priority,
        bool _isBlocking
    ) public onlyOwner {
        require(blocages[_id].id != 0, "Blocage not found");
        Blocage storage b = blocages[_id];
        b.name = _name;
        b.description = _description;
        b.status = _status;
        b.priority = _priority;
        b.isBlocking = _isBlocking;
        emit BlocageUpdated(_id);
    }

   function escaladeBlocage(uint256 _id, uint256 _toUserId) public onlyOwner {
        require(blocages[_id].id != 0, "Blocage not found");
        blocages[_id].assignedTo = _toUserId;
        emit BlocageEscalated(_id, _toUserId);
    }

         function resolveBlocage(uint256 _id, uint256 _byUserId, string memory _newStatus) public onlyOwner {
        require(blocages[_id].id != 0, "Blocage not found");
        Blocage storage b = blocages[_id];
        b.resolvedBy = _byUserId;
        b.status = _newStatus;
        if (b.isBlocking) {
            b.isBlocking = false;
            emit BlocageUpdated(_id); 
        }
        emit BlocageResolved(_id, _byUserId);
    }

    function deleteBlocage(uint256 _id) public onlyOwner {
        require(blocages[_id].id != 0, "Blocage not found");
        _removeUintFromArray(blocageIds, _id);
        delete blocages[_id];
        emit BlocageDeleted(_id);
    }
     function _removeUintFromArray(uint256[] storage arr, uint256 val) private {
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == val) {
                if (i != len - 1) {
                    arr[i] = arr[len - 1];
                }
                arr.pop();
                break;
            }
        }
    }

   function createTask(
        string memory _title,
        string memory _description,
        TaskStatus _status,
        uint256 _entityId,
        string memory _entityType,
        uint256 _createdByUserId
    ) public onlyOwner returns (uint256) {
        uint256 id = nextTaskId++;
        tasks[id] = Task({
            id: id,
            title: _title,
            description: _description,
            status: _status,
            entityId: _entityId,
            entityType: _entityType,
            createdAt: block.timestamp,
            createdBy: _createdByUserId
        });
        taskIds.push(id);
        emit TaskCreated(id);
        return id;
    }

    function updateTask(
        uint256 _id,
        string memory _title,
        string memory _description,
        TaskStatus _status
    ) public onlyOwner {
        require(tasks[_id].id != 0, "Task not found");
        Task storage t = tasks[_id];
        t.title = _title;
        t.description = _description;
        t.status = _status;
        emit TaskUpdated(_id);
    }

    function deleteTask(uint256 _id) public onlyOwner {
        require(tasks[_id].id != 0, "Task not found");
        _removeFromArray(taskIds, _id);
        delete tasks[_id];
        emit TaskDeleted(_id);
    }


   function createAction(
    string memory _nom,
    string memory _description,
    string memory _typeAction,
    uint256 _dateDebut,
    string memory _ville,
    uint256 _responsableId
) public onlyOwner returns (uint256) {
    uint256 id = nextActionId++;
    actions[id] = Action({
        id: id,
        nom: _nom,
        description: _description,
        typeAction: _typeAction,
        dateDebut: _dateDebut,
        ville: _ville,
        statut: ActionStatus.Planned,
        responsableId: _responsableId,
        createdAt: block.timestamp,
        createdBy: msg.sender
    });
    actionIds.push(id);
    emit ActionCreated(id);
    return id;
}
   function updateAction(
    uint256 _id,
    string memory _nom,
    string memory _description,
    string memory _typeAction,
    uint256 _dateDebut,
    string memory _ville,
    ActionStatus _statut,
    uint256 _responsableId
) public onlyOwner {
    require(actions[_id].id != 0, "Action not found");
    Action storage a = actions[_id];
    a.nom = _nom;
    a.description = _description;
    a.typeAction = _typeAction;
    a.dateDebut = _dateDebut;
    a.ville = _ville;
    a.statut = _statut;
    a.responsableId = _responsableId;
    emit ActionUpdated(_id);
    emit ActionStatusUpdated(_id, _statut);
}

   function updateActionStatus(uint256 _id, ActionStatus _status) public onlyOwner {
    require(actions[_id].id != 0, "Action not found");
    actions[_id].statut = _status;
    emit ActionStatusUpdated(_id, _status);
}

    function deleteAction(uint256 _id) public onlyOwner {
    require(actions[_id].id != 0, "Action not found");
    _removeFromArray(actionIds, _id);
    delete actions[_id];
    emit ActionDeleted(_id);
}

    function getAllInviters() public view returns (uint256[] memory) { return inviterIds; }
    function getAllProspects() public view returns (uint256[] memory) { return prospectIds; }
    function getAllInvestisseurs() public view returns (uint256[] memory) { return investisseurIds; }
    function getAllProjets() public view returns (uint256[] memory) { return projetIds; }
    function getAllBlocages() public view returns (uint256[] memory) { return blocageIds; }
    function getAllTasks() public view returns (uint256[] memory) { return taskIds; }
    function getAllActions() public view returns (uint256[] memory) { return actionIds; }

    function _removeFromArray(uint256[] storage array, uint256 value) internal {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == value) {
                array[i] = array[array.length - 1];
                array.pop();
                break;
            }
        }
    }

    function transferOwnership(address _newOwner) public onlyOwner {
        require(_newOwner != address(0), "zero address");
        owner = _newOwner;
    }
}
