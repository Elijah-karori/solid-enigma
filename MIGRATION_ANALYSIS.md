# Migration Analysis & Legacy System Specification

## 1. Executive Summary
This document provides a comprehensive migration analysis of the legacy **ONT Network Inventory & Resource Management Portal** (built on Google Apps Script, Google Sheets, and single-file HTML/JS) to a production-grade full-stack ERP architecture built with **Go (Echo + GORM)**, **PostgreSQL**, and **React + TypeScript + Vite + Tailwind CSS**.

## 2. Legacy Components
1. **Google Apps Script (`Code (6).gs`)**:
   - Backend logic, authentication (JWT/Magic Tokens/PBKDF2 passwords), session caching, and CRUD logic.
   - Core domain functions: Stock management, serialized device tracking (S/N, MAC), material requisitions workflow, procurement engine, project tracking, ticket management, task assignment, delivery note PDF generation, and tamper-evident audit logging.
2. **HTML/JS Frontend (`improves (6).html`)**:
   - Single-Page Application (SPA) using HTML, CSS, JavaScript, dynamic modals, barcode/QR camera scanner integration, and responsive layout.
3. **Excel Workbook (`serialized_ONT_inventory_register (1) (7).xlsx`)**:
   - Initial seed data and historical records containing 17 sheets (`Stock Summary`, `Procurement`, `Delivery Notes`, `Tasks`, `Notification Log`, `Inventory Settings`, `Customer Issues`, `Technician Requisitions`, `Serialized Inventory`, `Horizontal Register`, `Item Catalog`, `Transaction Ledger`, `User Directory`, `Magic Tokens`, `Customer Mappings`, `Network Topology & Locations`, `Projects & Infrastructure`).

## 3. Key Workflows & State Machines

### 3.1 Technician Material Request Flow
- **States**: `Pending Approval` -> `Pending Finance` (if cost threshold/project rule applies) -> `Approved - Ready` / `Awaiting Stock` -> `Issued` (or `Rejected` / `Cancelled`).
- **Validation Rules**:
  - Requester cannot approve their own requisition.
  - Stock availability check prior to transition to `Approved - Ready`.
  - Serialized item assignment during `Issue` phase transitions physical device status from `In Stock` to `Issued / Out`.
  - Requisition issuance generates an immutable inventory ledger transaction, updates project budget/actual spend, and logs audit events.

### 3.2 Device Replacement Workflow
- **States**: Ticket `Open` -> `Assigned` -> `In Progress` -> `Resolved` -> `Closed`.
- **Logic**:
  - Customer ticket links `Old Device S/N` and `Replacement Device S/N`.
  - Old device status updated to `Under Repair` / `Decommissioned` / `Returned`.
  - New device status updated to `Issued / Out` and assigned to customer/site/task.
  - Financial replacement cost recorded against task/project/ticket.

### 3.3 Procurement Flow
- **States**: `Pending Finance` -> `Approved` -> `Ordered` -> `Received` -> `Stock In` (or `Rejected` / `Cancelled`).
- **Logic**: Receiving procurement automatically triggers a Stock In transaction, creating serialized units or increasing bulk/nonserialized item stock balances.

## 4. User Roles & Permission Matrix
- **Roles**: Admin, Store Manager, Finance, Project Manager, Support, Technician.
- **Permissions**: `viewCosts`, `viewLedger`, `manageUsers`, `viewStock`, `manageCatalog`, `moveStock`, `manageDevices`, `approveReq`, `approveFinance`, `viewAllReqs`, `createTicket`, `viewAllTickets`, `createTask`, `viewAllTasks`, `requestMaterial`, `manageProjects`, `viewProcurement`, `requestProcurement`, `approveProcurement`, `receiveProcurement`, `generatePDF`, `viewDocs`, `managePayments`.

## 5. Identified Gaps & Refinements in Migration Target
1. **Serialized Items Details**: Explicit forms and API endpoints for S/N, MAC address, vendor, condition, batch/PO reference on Stock In and edit operations.
2. **Customers Module**: Complete management of customer profiles, subscription types (PPPoE, Hotspot), plot numbers, physical location/GPS, contact persons, and list of hotspot users per hotspot.
3. **Network Topology & GIS**: Multi-layered topology model linking OLT -> PON -> Splitter -> FAT/Enclosure -> ONU -> Customer & Hotspot APs, with interactive visual tree, physical GIS map, and customer path tracer.
4. **GenieACS TR-069 Integration**:
   - Server-side REST integration with GenieACS API.
   - TR-069 detail views (optical power, WAN IP, uptime, Wi-Fi status, raw CWMP parameters).
   - Remote operational actions: Sync, Reboot, Factory Reset (RBAC protected), parameter refresh.
   - Event-driven sync & cached operational snapshot in PostgreSQL.
5. **FreeRADIUS / Hotspot Sync**:
   - BSS/ERP system of record for Hotspot users, vouchers (e.g. 3-hr / 2-device limit), subscriptions.
   - Synchronized to FreeRADIUS/MikroTik via event adapter.
