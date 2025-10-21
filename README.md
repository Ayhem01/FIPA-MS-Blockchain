# CRM FIPA Microservice

A Node.js microservice that provides RESTful API endpoints for interacting with the CRM FIPA smart contract on Ethereum blockchain, designed to accept HTTP requests from PHP backends.

## 🚀 Features

- **Smart Contract Integration**: Deploy and interact with CRM FIPA smart contract
- **Ganache Connection**: Connect to local Ganache blockchain for development
- **RESTful API**: Complete API for inviter, prospect, and task management
- **Web3.js Integration**: Seamless blockchain interactions
- **PHP Backend Compatible**: CORS-enabled for PHP backend integration
- **Event Monitoring**: Real-time blockchain event tracking
- **Automated Deployment**: Scripts for easy contract deployment

## 📋 Prerequisites

- Node.js (v14 or higher)
- Ganache CLI or Ganache GUI
- PHP backend (for integration)

## 🛠️ Installation

1. **Clone and setup the project:**
   ```bash
   git clone <your-repo>
   cd ms-backend
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Start Ganache:**
   ```bash
   # Using Ganache CLI
   ganache-cli --host 0.0.0.0 --port 7545 --networkId 5777
   
   # Or use Ganache GUI on http://127.0.0.1:7545
   ```

## 🚀 Quick Start

### 1. Deploy Smart Contract

```bash
# Using npm script with private key
npm run deploy

# Or using node script directly
node scripts/deploy.js YOUR_PRIVATE_KEY
```

### 2. Start the Microservice

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

The microservice will be available at `http://localhost:3000`

### 3. Test Connection

```bash
curl http://localhost:3000/health
```

## 📚 API Documentation

### Base URL: `http://localhost:3000/api`

### Contract Management

- `GET /contract/init` - Initialize Web3 connection
- `GET /contract/info` - Get contract information
- `GET /contract/balance/:address` - Get account balance
- `GET /contract/events` - Get all contract events
- `GET /contract/events/:eventName` - Get specific event type

### Deployment

- `POST /deploy` - Deploy new contract
- `POST /deploy/load` - Load existing contract
- `GET /deploy/status` - Get deployment status

### Inviter Management

- `POST /inviter` - Add new inviter
- `GET /inviter/:inviterId` - Get inviter details
- `POST /inviter/:inviterId/accept` - Accept invitation
- `POST /inviter/:inviterId/reject` - Reject invitation
- `GET /inviter/pending/all` - Get all pending inviters
- `GET /inviter/accepted/all` - Get all accepted inviters
- `GET /inviter/:inviterId/status` - Check inviter status
- `POST /inviter/:inviterId/convert` - Convert to prospect

### Prospect Management

- `POST /prospect` - Create new prospect
- `GET /prospect` - Get all prospects
- `GET /prospect/:prospectId` - Get prospect details
- `POST /prospect/:prospectId/advance` - Advance to next stage
- `POST /prospect/:prospectId/convert` - Convert to investor
- `GET /prospect/:prospectId/can-convert` - Check conversion eligibility
- `GET /prospect/:prospectId/progress` - Get progress percentage
- `GET /prospect/:prospectId/tasks` - Get prospect tasks
- `GET /prospect/:prospectId/tasks/stage/:stageId` - Get stage-specific tasks
- `POST /prospect/:prospectId/stage/:stageId/final` - Set stage as final

### Task Management

- `POST /task` - Create new task
- `GET /task/:taskId` - Get task details
- `PUT /task/:taskId/status` - Update task status
- `GET /task/stages/all` - Get all pipeline stages
- `GET /task/stages/:stageId` - Get stage details
- `POST /task/stages` - Create new pipeline stage
- `GET /task/types` - Get enum mappings

## 💡 Usage Examples

### Deploy Contract from PHP

```php
$response = file_get_contents('http://localhost:3000/api/deploy', false, stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => 'Content-Type: application/json',
        'content' => json_encode([
            'privateKey' => '0x...'
        ])
    ]
]));
```

### Add Inviter

```bash
curl -X POST http://localhost:3000/api/inviter \
  -H "Content-Type: application/json" \
  -d '{
    "inviterId": 1,
    "privateKey": "0x..."
  }'
```

### Create Prospect

```bash
curl -X POST http://localhost:3000/api/prospect \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "responsiblePerson": 123,
    "privateKey": "0x..."
  }'
```

### Create Task

```bash
curl -X POST http://localhost:3000/api/task \
  -H "Content-Type: application/json" \
  -d '{
    "prospectId": 1,
    "stageId": 1,
    "title": "Initial Call",
    "description": "First contact with prospect",
    "start": 1640995200,
    "end": 1640998800,
    "taskType": 0,
    "priority": 2,
    "assigneeId": 123,
    "privateKey": "0x..."
  }'
```

## 🔧 Configuration

### Environment Variables

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Ganache Configuration
GANACHE_URL=http://127.0.0.1:7545
NETWORK_ID=5777

# Contract Configuration
CONTRACT_ADDRESS=0x...
DEPLOYER_PRIVATE_KEY=0x...

# Security
ALLOWED_ORIGINS=http://localhost:8000,http://localhost:3000

# Gas Configuration
GAS_LIMIT=6721975
GAS_PRICE=20000000000
```

### Enum Values

#### Task Types
- `0` - Call
- `1` - Meeting
- `2` - EmailJournal
- `3` - Note
- `4` - Todo

#### Task Status
- `0` - NotStarted
- `1` - InProgress
- `2` - Completed
- `3` - Deferred
- `4` - Waiting

#### Task Priority
- `0` - Low
- `1` - Medium
- `2` - High
- `3` - Urgent

#### Prospect Status
- `0` - Nouveau
- `1` - EnCours
- `2` - Qualifie
- `3` - NonQualifie
- `4` - Converti
- `5` - Perdu

#### Inviter Status
- `0` - Pending
- `1` - Accepted
- `2` - Rejected

## 🏗️ Project Structure

```
ms-backend/
├── contracts/           # Smart contract files
│   ├── crmfipa.sol     # Main contract
│   ├── crmfipa-abi.json # Generated ABI
│   └── deployment.json  # Deployment info
├── routes/             # API route handlers
│   ├── contract.js     # Contract operations
│   ├── deploy.js       # Deployment routes
│   ├── inviter.js      # Inviter management
│   ├── prospect.js     # Prospect management
│   └── task.js         # Task management
├── scripts/            # Utility scripts
│   └── deploy.js       # Deployment script
├── services/           # Service layer
│   └── web3Service.js  # Web3 integration
├── .env               # Environment configuration
├── package.json       # Dependencies
└── server.js          # Main application
```

## 🔐 Security Considerations

- Never expose private keys in client-side code
- Use environment variables for sensitive configuration
- Implement proper authentication for production
- Validate all input parameters
- Use HTTPS in production

## 🐛 Troubleshooting

### Common Issues

1. **Ganache Connection Failed**
   - Ensure Ganache is running on the correct port
   - Check GANACHE_URL in .env file

2. **Contract Deployment Failed**
   - Verify private key has sufficient ETH balance
   - Check gas limits and prices

3. **Transaction Reverted**
   - Verify contract function parameters
   - Check account permissions and contract state

### Debug Mode

Set `NODE_ENV=development` for detailed error messages and logging.

## 📝 API Response Format

All API responses follow this standard format:

```json
{
  "success": true|false,
  "data": {
    // Response data (on success)
  },
  "error": "Error message (on failure)"
}
```

## 🤝 Integration with PHP Backend

The microservice is designed to work seamlessly with PHP backends:

1. **CORS Enabled**: Configure allowed origins in .env
2. **Standard HTTP Methods**: GET, POST, PUT for different operations
3. **JSON Format**: All requests and responses use JSON
4. **Error Handling**: Consistent error response format

## 📄 License

ISC License

## 🚀 Deployment to Production

1. Use a production Ethereum network (not Ganache)
2. Set proper environment variables
3. Use a process manager like PM2
4. Enable HTTPS
5. Implement proper logging and monitoring

---

For detailed API documentation and examples, visit the `/health` endpoint when the service is running.