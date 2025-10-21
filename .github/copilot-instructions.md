<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# CRM FIPA Microservice - Copilot Instructions

This is a Node.js microservice project that interacts with an Ethereum smart contract using Web3.js and connects to Ganache for blockchain development.

## Project Structure
- **Smart Contract**: Solidity contract for CRM FIPA system with inviter/prospect management
- **Web3 Service**: Service layer for blockchain interactions
- **Express API**: RESTful API endpoints for PHP backend integration
- **Routes**: Organized by functionality (contract, inviter, prospect, task, deploy)

## Key Technologies
- Node.js + Express.js for REST API
- Web3.js for Ethereum blockchain interaction
- Solc for smart contract compilation
- Ganache for local blockchain development
- CORS enabled for cross-origin requests from PHP backend

## Smart Contract Features
- Inviter management (pending, accepted, rejected states)
- Prospect pipeline with customizable stages
- Task management with types, priorities, and statuses
- Event logging for all major operations
- Owner-only administrative functions

## API Patterns
- All routes return standardized JSON responses with `success` and `data/error` fields
- Private key required for state-changing operations
- Transaction hashes and gas usage included in responses
- Comprehensive error handling with meaningful messages

## Environment Configuration
- Ganache connection settings in .env
- Contract address automatically updated after deployment
- CORS origins configurable for security

When generating code for this project, follow these patterns and maintain consistency with the existing architecture.