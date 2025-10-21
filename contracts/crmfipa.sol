// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
/**
 * @title InviterAndProspectRegistry
 * @dev Manages inviters and prospects with their pipeline stages
 */
contract crmfipa {
    address public owner;
    
    // Inviter Status Enum
    enum InviterStatus { Pending, Accepted, Rejected }
    
    // Prospect Status Enum
    enum ProspectStatus { Nouveau, EnCours, Qualifie, NonQualifie, Converti, Perdu }
    
    // Task Status Enum
    enum TaskStatus { NotStarted, InProgress, Completed, Deferred, Waiting }
    
    // Task Type Enum
    enum TaskType { Call, Meeting, EmailJournal, Note, Todo }
    
    // Task Priority Enum
    enum TaskPriority { Low, Medium, High, Urgent }
    
    // Inviter Struct
    struct Inviter {
        uint256 id;
        InviterStatus status;
        uint256 invitedAt;
        uint256 respondedAt;
        bool isConvertedToProspect;
        uint256 prospectId;
    }
    
    // Pipeline Stage Struct
    struct PipelineStage {
        uint256 id;
        string name;
        uint256 order;
        bool isFinal;
        bool isActive;
    }
    
    // Prospect Struct
    struct Prospect {
        uint256 id;
        uint256 inviterId;
        string name;
        ProspectStatus status;
        uint256 currentStageId;
        uint256 responsiblePerson;
        uint256 createdAt;
        uint256 convertedAt;
        uint256 investorId;
        bool isPipelineCompleted;
    }
    
    // Pipeline Progression Struct
    struct PipelineProgression {
        uint256 prospectId;
        uint256 stageId;
        bool completed;
        uint256 completedAt;
        uint256 assignedTo;
        string notes;
    }
    
    // Task Struct
    struct Task {
        uint256 id;
        string title;
        string description;
        uint256 start;
        uint256 end;
        TaskType taskType;
        TaskStatus status;
        TaskPriority priority;
        uint256 assigneeId;
        uint256 entityId; // prospect ID
        uint256 stageId;
    }
    
    // Mappings
    mapping(uint256 => Inviter) public inviters;
    mapping(uint256 => Prospect) public prospects;
    mapping(uint256 => PipelineStage) public pipelineStages;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => mapping(uint256 => bool)) public isStageFinalForProspect;

    // Arrays for tracking
    uint256[] public pendingInviterIds;
    uint256[] public acceptedInviterIds;
    uint256[] public prospectIds;
    uint256[] public taskIds;
    
    // Complex mapping for progression tracking
    mapping(uint256 => mapping(uint256 => PipelineProgression)) public progressions; // prospect ID => stage ID => progression
    mapping(uint256 => uint256[]) public prospectProgressionStages; // prospect ID => array of stage IDs
    mapping(uint256 => uint256[]) public stageTasks; // stageId => array of task IDs
    mapping(uint256 => uint256[]) public prospectTasks; // prospectId => array of task IDs
    
    // Counter for generating IDs
    uint256 public nextProspectId = 1;
    uint256 public nextTaskId = 1;
    uint256 public nextStageId = 1;
    
    // Events
    event InviterAdded(uint256 inviterId);
    event InvitationAccepted(uint256 inviterId);
    event InvitationRejected(uint256 inviterId);
    event ProspectCreated(uint256 prospectId, uint256 inviterId);
    event ProspectAdvanced(uint256 prospectId, uint256 fromStage, uint256 toStage);
    event ProspectConverted(uint256 prospectId, uint256 investorId);
    event PipelineStageCreated(uint256 stageId, string name, uint256 order);
    event TaskCreated(uint256 taskId, uint256 prospectId, uint256 stageId);
    event TaskCompleted(uint256 taskId);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    constructor() {
        owner = msg.sender;
        
        // Initialize default pipeline stages
        createPipelineStage("Initial Contact", 1, false, true);
        createPipelineStage("Needs Assessment", 2, false, true);
        createPipelineStage("Proposal", 3, false, true);
        createPipelineStage("Negotiation", 4, false, true);
        createPipelineStage("Final Decision", 5, true, true);
    }
    
    // INVITER MANAGEMENT FUNCTIONS
    
    /**
     * @dev Add a new inviter with pending status
     * @param _inviterId The ID of the inviter to add
     */
    function addInviter(uint256 _inviterId) public onlyOwner {
        require(inviters[_inviterId].invitedAt == 0, "Inviter already exists");
        
        inviters[_inviterId] = Inviter({
            id: _inviterId,
            status: InviterStatus.Pending,
            invitedAt: block.timestamp,
            respondedAt: 0,
            isConvertedToProspect: false,
            prospectId: 0
        });
        
        pendingInviterIds.push(_inviterId);
        
        emit InviterAdded(_inviterId);
    }
    
    /**
     * @dev Accept invitation for a specific inviter
     * @param _inviterId The ID of the inviter accepting the invitation
     */
    function acceptInvitation(uint256 _inviterId) public {
        require(inviters[_inviterId].invitedAt > 0, "Inviter does not exist");
        require(inviters[_inviterId].status == InviterStatus.Pending, "Inviter is not in pending status");
        
        inviters[_inviterId].status = InviterStatus.Accepted;
        inviters[_inviterId].respondedAt = block.timestamp;
        
        // Move from pending to accepted list
        _removeFromArray(pendingInviterIds, _inviterId);
        acceptedInviterIds.push(_inviterId);
        
        emit InvitationAccepted(_inviterId);
    }
    
    /**
     * @dev Reject invitation for a specific inviter
     * @param _inviterId The ID of the inviter rejecting the invitation
     */
    function rejectInvitation(uint256 _inviterId) public {
        require(inviters[_inviterId].invitedAt > 0, "Inviter does not exist");
        require(inviters[_inviterId].status == InviterStatus.Pending, "Inviter is not in pending status");
        
        inviters[_inviterId].status = InviterStatus.Rejected;
        inviters[_inviterId].respondedAt = block.timestamp;
        
        // Remove from pending list
        _removeFromArray(pendingInviterIds, _inviterId);
        
        emit InvitationRejected(_inviterId);
    }
    
    // PROSPECT MANAGEMENT FUNCTIONS
    
    /**
     * @dev Convert an accepted inviter to a prospect
     * @param _inviterId The ID of the inviter to convert
     * @param _name Name for the new prospect
     * @param _responsiblePerson Address responsible for this prospect
     */
    function convertInviterToProspect(
        uint256 _inviterId, 
        string memory _name, 
        uint256 _responsiblePerson
    ) public returns (uint256) {
        require(inviters[_inviterId].status == InviterStatus.Accepted, "Inviter must be accepted first");
        require(!inviters[_inviterId].isConvertedToProspect, "Inviter already converted to prospect");
        
        uint256 prospectId = nextProspectId++;
        
        // Create the prospect
        prospects[prospectId] = Prospect({
            id: prospectId,
            inviterId: _inviterId,
            name: _name,
            status: ProspectStatus.Nouveau,
            currentStageId: 1, // First stage
            responsiblePerson: _responsiblePerson,
            createdAt: block.timestamp,
            convertedAt: 0,
            investorId: 0,
            isPipelineCompleted: false
        });
        
        prospectIds.push(prospectId);
        
        // Update the inviter
        inviters[_inviterId].isConvertedToProspect = true;
        inviters[_inviterId].prospectId = prospectId;
        
        // Initialize the first pipeline stage progression
        _initializeProspectPipeline(prospectId, _responsiblePerson);
        
        emit ProspectCreated(prospectId, _inviterId);
        
        return prospectId;
    }
    
    /**
     * @dev Create a new prospect directly (without inviter)
     * @param _name Name for the new prospect
     * @param _responsiblePerson Address responsible for this prospect
     */
    function createProspect(
        string memory _name, 
        uint256 _responsiblePerson
    ) public returns (uint256) {
        uint256 prospectId = nextProspectId++;
        
        prospects[prospectId] = Prospect({
            id: prospectId,
            inviterId: 0, // No inviter
            name: _name,
            status: ProspectStatus.Nouveau,
            currentStageId: 1, // First stage
            responsiblePerson: _responsiblePerson,
            createdAt: block.timestamp,
            convertedAt: 0,
            investorId: 0,
            isPipelineCompleted: false
        });
        
        prospectIds.push(prospectId);
        
        // Initialize the first pipeline stage progression
        _initializeProspectPipeline(prospectId, _responsiblePerson);
        
        emit ProspectCreated(prospectId, 0);
        
        return prospectId;
    }
    
    /**
     * @dev Advance a prospect to the next pipeline stage
     * @param _prospectId The ID of the prospect to advance
     * @param _notes Notes for this progression
     */
function advanceProspectToNextStage(
    uint256 _prospectId,
    string memory _notes
) public returns (bool) {
    require(prospects[_prospectId].id > 0, "Prospect does not exist");
    require(!prospects[_prospectId].isPipelineCompleted, "Pipeline already completed");

    Prospect storage prospect = prospects[_prospectId];
    uint256 currentStageId = prospect.currentStageId;
    PipelineStage storage currentStage = pipelineStages[currentStageId];

    // Determine if current stage is final for this prospect:
    bool isFinalForThisProspect = pipelineStages[currentStageId].isFinal || isStageFinalForProspect[_prospectId][currentStageId];
    emit ProspectAdvanced(_prospectId, 1, 2);

    // If current stage is final, mark pipeline as completed
    if (isFinalForThisProspect) {
        prospect.isPipelineCompleted = true;
        
        return true;
    }

    // Find next stage
    uint256 _nextStageId = findNextStageId(currentStageId);
    if (_nextStageId == 0) {
        return false;
    }

    // Mark current stage as completed
    PipelineProgression storage progression = progressions[_prospectId][currentStageId];
    progression.completed = true;
    progression.completedAt = block.timestamp;
    progression.notes = _notes;

    // Create progression for next stage (if not already created)
    if (progressions[_prospectId][_nextStageId].prospectId == 0) {
        _createProgressionForStage(_prospectId, _nextStageId, prospect.responsiblePerson);
    }

    // Update prospect's current stage
    uint256 oldStageId = prospect.currentStageId;
    prospect.currentStageId = _nextStageId;

    emit ProspectAdvanced(_prospectId, oldStageId, _nextStageId);

    return true;
}

    
    /**
     * @dev Convert a prospect to an investor (final stage)
     * @param _prospectId The ID of the prospect to convert
     * @param _investorId The ID assigned to the new investor
     */
    function convertProspectToInvestor(
        uint256 _prospectId,
        uint256 _investorId
    ) public returns (bool) {
        require(prospects[_prospectId].id > 0, "Prospect does not exist");
        require(prospects[_prospectId].convertedAt == 0, "Prospect already converted");
        
        Prospect storage prospect = prospects[_prospectId];
        PipelineStage storage currentStage = pipelineStages[prospect.currentStageId];
        
        // Only final stage prospects can be converted
        require(currentStage.isFinal, "Prospect must be in final stage to convert");
        
        // Mark prospect as converted
        prospect.status = ProspectStatus.Converti;
        prospect.convertedAt = block.timestamp;
        prospect.investorId = _investorId;
        prospect.isPipelineCompleted = true;
        
        emit ProspectConverted(_prospectId, _investorId);
        
        return true;
    }
    
    // PIPELINE MANAGEMENT FUNCTIONS
    
    /**
     * @dev Create a new pipeline stage
     * @param _name Name of the stage
     * @param _order Order in the pipeline sequence
     * @param _isFinal Whether this is a final stage
     * @param _isActive Whether this stage is active
     */
    function createPipelineStage(
        string memory _name,
        uint256 _order,
        bool _isFinal,
        bool _isActive
    ) public onlyOwner returns (uint256) {
        uint256 stageId = nextStageId++;
        
        pipelineStages[stageId] = PipelineStage({
            id: stageId,
            name: _name,
            order: _order,
            isFinal: _isFinal,
            isActive: _isActive
        });
        
        emit PipelineStageCreated(stageId, _name, _order);
        
        return stageId;
    }
    
    /**
     * @dev Find the next stage ID based on order
     * @param _currentStageId The current stage ID
     */
    function findNextStageId(uint256 _currentStageId) public view returns (uint256) {
        PipelineStage storage currentStage = pipelineStages[_currentStageId];
        uint256 currentOrder = currentStage.order;
        uint256 minNextOrder = type(uint256).max;
        uint256 foundStageId = 0;  // Local variable (safe)

        for (uint256 i = 1; i < nextStageId; i++) {  // `nextStageId` is the state counter
            PipelineStage storage stage = pipelineStages[i];
            if (stage.isActive && stage.order > currentOrder && stage.order < minNextOrder) {
                minNextOrder = stage.order;
                foundStageId = i;  
            }
        }
        return foundStageId;
    }
    
    // TASK MANAGEMENT FUNCTIONS
    
    /**
     * @dev Create a task for a prospect at a specific pipeline stage
     * @param _prospectId The ID of the prospect
     * @param _stageId The pipeline stage ID
     * @param _title Task title
     * @param _description Task description
     * @param _start Start timestamp
     * @param _end End timestamp
     * @param _taskType Task type (0=Call, 1=Meeting, etc.)
     * @param _priority Task priority (0=Low, 1=Medium, etc.)
     * @param _assigneeId Address of the assignee
     */
    function createTask(
        uint256 _prospectId,
        uint256 _stageId,
        string memory _title,
        string memory _description,
        uint256 _start,
        uint256 _end,
        TaskType _taskType,
        TaskPriority _priority,
        uint256 _assigneeId
    ) public returns (uint256) {
        require(prospects[_prospectId].id > 0, "Prospect does not exist");
        require(pipelineStages[_stageId].id > 0, "Pipeline stage does not exist");
        
        uint256 taskId = nextTaskId++;
        
        tasks[taskId] = Task({
            id: taskId,
            title: _title,
            description: _description,
            start: _start,
            end: _end,
            taskType: _taskType,
            status: TaskStatus.NotStarted,
            priority: _priority,
            assigneeId: _assigneeId,
            entityId: _prospectId,
            stageId: _stageId
        });
        
        taskIds.push(taskId);
        stageTasks[_stageId].push(taskId);
        prospectTasks[_prospectId].push(taskId);
        
        emit TaskCreated(taskId, _prospectId, _stageId);
        
        return taskId;
    }
    
    /**
     * @dev Update a task status
     * @param _taskId The ID of the task
     * @param _status New task status
     */
    function updateTaskStatus(uint256 _taskId, TaskStatus _status) public returns (bool) {
        require(tasks[_taskId].id > 0, "Task does not exist");
        
        Task storage task = tasks[_taskId];
        
        // Only the assignee or the owner can update the status
        
        task.status = _status;
        
        if (_status == TaskStatus.Completed) {
            emit TaskCompleted(_taskId);
        }
        
        return true;
    }
    
    /**
     * @dev Get all tasks for a prospect at a specific stage
     * @param _prospectId The prospect ID
     * @param _stageId The stage ID
     * @return Array of task IDs
     */
    function getTasksForProspectStage(uint256 _prospectId, uint256 _stageId) public view returns (uint256[] memory) {
        uint256[] memory allTasks = prospectTasks[_prospectId];
        uint256 count = 0;
        
        // First count matching tasks
        for (uint256 i = 0; i < allTasks.length; i++) {
            if (tasks[allTasks[i]].stageId == _stageId) {
                count++;
            }
        }
        
        // Then create and populate result array
        uint256[] memory result = new uint256[](count);
        uint256 resultIndex = 0;
        
        for (uint256 i = 0; i < allTasks.length; i++) {
            if (tasks[allTasks[i]].stageId == _stageId) {
                result[resultIndex] = allTasks[i];
                resultIndex++;
            }
        }
        
        return result;
    }
    
    /**
     * @dev Calculate progression percentage for a prospect
     * @param _prospectId The prospect ID
     */
    function calculateProgressionPercentage(uint256 _prospectId) public view returns (uint256) {
        require(prospects[_prospectId].id > 0, "Prospect does not exist");
        
        // If pipeline is completed, return 100%
        if (prospects[_prospectId].isPipelineCompleted) {
            return 100;
        }
        
        uint256 totalActiveStages = 0;
        uint256 completedStages = 0;
        
        // Count active stages and completed stages
        for (uint256 i = 1; i < nextStageId; i++) {
            if (pipelineStages[i].isActive) {
                totalActiveStages++;
                
                if (progressions[_prospectId][i].completed) {
                    completedStages++;
                }
            }
        }
        
        if (totalActiveStages == 0) {
            return 0;
        }
        
        return (completedStages * 100) / totalActiveStages;
    }
    
    // HELPER FUNCTIONS
    
    /**
     * @dev Initialize pipeline for a new prospect
     * @param _prospectId The prospect ID
     * @param _assignedTo Who is assigned to the first stage
     */
    function _initializeProspectPipeline(uint256 _prospectId, uint256 _assignedTo) internal {
        uint256 firstStageId = 1; // We initialized with id=1 as first stage
        
        _createProgressionForStage(_prospectId, firstStageId, _assignedTo);
        prospects[_prospectId].currentStageId = firstStageId;
    }
    
    /**
     * @dev Create a progression record for a stage
     * @param _prospectId The prospect ID
     * @param _stageId The stage ID
     * @param _assignedTo Who is assigned to this stage
     */
function _createProgressionForStage(uint256 _prospectId, uint256 _stageId, uint256 _assignedTo) internal {
    // If progression already exists (check prospectId), skip or update
    if (progressions[_prospectId][_stageId].prospectId != 0) {
        // already initialized
        return;
    }

    progressions[_prospectId][_stageId] = PipelineProgression({
        prospectId: _prospectId,
        stageId: _stageId,
        completed: false,
        completedAt: 0,
        assignedTo: _assignedTo,
        notes: ""
    });

    prospectProgressionStages[_prospectId].push(_stageId);
}
    
    /**
     * @dev Remove an element from an array
     * @param array The array to modify
     * @param value The value to remove
     */
    function _removeFromArray(uint256[] storage array, uint256 value) internal {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == value) {
                // Move the last element to the position of the removed element
                array[i] = array[array.length - 1];
                // Remove the last element
                array.pop();
                break;
            }
        }
    }
    
    // GETTER FUNCTIONS
    
    /**
     * @dev Get all prospects
     * @return Array of prospect IDs
     */
    function getAllProspects() public view returns (uint256[] memory) {
        return prospectIds;
    }
    
    /**
     * @dev Get all pipeline stages
     * @return Array of active stage IDs
     */
    function getAllActiveStages() public view returns (uint256[] memory) {
        // First count active stages
        uint256 count = 0;
        for (uint256 i = 1; i < nextStageId; i++) {
            if (pipelineStages[i].isActive) {
                count++;
            }
        }
        
        // Create and populate result array
        uint256[] memory result = new uint256[](count);
        uint256 resultIndex = 0;
        
        for (uint256 i = 1; i < nextStageId; i++) {
            if (pipelineStages[i].isActive) {
                result[resultIndex] = i;
                resultIndex++;
            }
        }
        
        return result;
    }
    
    /**
     * @dev Get all tasks for a prospect
     * @param _prospectId The prospect ID
     * @return Array of task IDs
     */
    function getProspectTasks(uint256 _prospectId) public view returns (uint256[] memory) {
        return prospectTasks[_prospectId];
    }
    
    /**
     * @dev Check if a prospect can be converted to an investor
     * @param _prospectId The prospect ID
     * @return Whether prospect can be converted
     */
    function canConvertToInvestor(uint256 _prospectId) public view returns (bool) {
        require(prospects[_prospectId].id > 0, "Prospect does not exist");
        
        // Already converted
        if (prospects[_prospectId].convertedAt > 0) {
            return false;
        }
        
        // Must be in final stage
        Prospect storage prospect = prospects[_prospectId];
        PipelineStage storage currentStage = pipelineStages[prospect.currentStageId];
        
        return currentStage.isFinal;
    }
    function getAllAcceptedInviterIds() public view returns (uint256[] memory) {
    return acceptedInviterIds;
}
    function getAllPendingInviterIds() public view returns (uint256[] memory) {
        return pendingInviterIds;
    }
/**
 * @dev Check if an inviter is in pending status
 * @param _inviterId The ID of the inviter to check
 * @return True if the inviter is pending, false otherwise
 */
    function isInviterPending(uint256 _inviterId) public view returns (bool) {
        require(inviters[_inviterId].invitedAt > 0, "Inviter does not exist");
        return inviters[_inviterId].status == InviterStatus.Pending;
    }

    /**
    * @dev Check if an inviter is in accepted status
    * @param _inviterId The ID of the inviter to check
    * @return True if the inviter is accepted, false otherwise
    */
    function isInviterAccepted(uint256 _inviterId) public view returns (bool) {
        require(inviters[_inviterId].invitedAt > 0, "Inviter does not exist");
        return inviters[_inviterId].status == InviterStatus.Accepted;
    }

    /**
    * @dev Check if an inviter is in rejected status
    * @param _inviterId The ID of the inviter to check
    * @return True if the inviter is rejected, false otherwise
    */
    function isInviterRejected(uint256 _inviterId) public view returns (bool) {
        require(inviters[_inviterId].invitedAt > 0, "Inviter does not exist");
        return inviters[_inviterId].status == InviterStatus.Rejected;
    }
/**
 * @dev Get the status of an inviter as a string
 * @param _inviterId The ID of the inviter
 * @return String representing the status ("Pending", "Accepted", or "Rejected")
 */
    function getInviterStatusString(uint256 _inviterId) public view returns (string memory) {
        require(inviters[_inviterId].invitedAt > 0, "Inviter does not exist");

        if (inviters[_inviterId].status == InviterStatus.Pending) {
            return "Pending";
        } else if (inviters[_inviterId].status == InviterStatus.Accepted) {
            return "Accepted";
        } else {
            return "Rejected";
        }
    }
    /**
 * @dev Set a stage as final specifically for a prospect
 * @param _prospectId The ID of the prospect
 * @param _stageId The ID of the pipeline stage
 * @param _isFinal Whether this stage should be final for this prospect
 */
function setStageFinalForProspect(
    uint256 _prospectId,
    uint256 _stageId,
    bool _isFinal
) public onlyOwner returns (bool) {
    require(prospects[_prospectId].id > 0, "Prospect does not exist");
    require(pipelineStages[_stageId].id > 0, "Pipeline stage does not exist");

    isStageFinalForProspect[_prospectId][_stageId] = _isFinal;
    // Only modify the global pipeline stage if caller truly intends to change global flag:
    // (optionally) pipelineStages[_stageId].isFinal = _isFinal; // uncomment if you want global effect

    // Update prospect's pipeline completion status if this is their current stage
    if (prospects[_prospectId].currentStageId == _stageId) {
        if (_isFinal && progressions[_prospectId][_stageId].completed) {
            prospects[_prospectId].isPipelineCompleted = true;
        } else if (!_isFinal) {
            prospects[_prospectId].isPipelineCompleted = false;
        }
    }

    return true;
}
}