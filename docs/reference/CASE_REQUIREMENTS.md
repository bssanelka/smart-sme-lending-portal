# Smart Lending Portal for Entrepreneurs

## Summary

- The task is to create a digital lending pipeline for small and micro businesses.
- It should help an entrepreneur move from identifying a financing need to receiving an application outcome.
- It should also allow the bank to manage this process within a single product.

## Contents

1. [Business Context](#business-context)
2. [Task](#task)
3. [Success Criteria](#success-criteria)
4. [Constraints](#constraints)
5. [Solution Space](#solution-space)
6. [Minimum End-to-End Lending Journey](#minimum-end-to-end-lending-journey)

## Business Context

### Market Context

- Small and micro businesses are one of the largest segments of the Russian economy by number of business entities.
- As of July 10, 2026, the Unified Register of Small and Medium-Sized Enterprises included:
  - 6.6 million companies and individual entrepreneurs;
  - 3.5% more than one year earlier.

### Business Financing Needs

- Entrepreneurs regularly use financial instruments to develop their businesses.
- Lending helps them:
  - purchase equipment;
  - replenish working capital;
  - launch new business lines;
  - address current operational needs.
- Business needs vary significantly:
  - one client may need a small amount for a short term;
  - another may need financing for a large project, taking into account financial metrics, collateral, and additional terms.

### The Bank's Perspective

- Serving small and micro businesses requires a bank to process a large number of applications with different:
  - parameters;
  - products;
  - risk levels.
- As of July 2026, Russian banks had issued RUB 1.313 trillion in loans to small and medium-sized enterprises.
- Small-business lending is an important business area for Alfa-Bank.
- In October 2025, Alfa-Bank's total volume of loans issued to small businesses exceeded RUB 1 trillion.

### The Client's Lending Journey

- Business lending involves more than completing an application.
- A client needs to:
  - identify the financing need;
  - select an appropriate product and terms;
  - prepare company information;
  - submit information to the bank;
  - understand what happens to the request afterward.
- A user may have no financial or banking expertise.
- The user may not always understand which financing option best fits their situation.

### Internal Application Processing

- On the bank's side, an application passes through several stages:
  - checking data for completeness and correctness;
  - obtaining information from internal and external sources;
  - assessing credit risk;
  - making a decision.
- Different roles, information systems, and data sources may be involved.
- Some operations may be performed automatically.
- Other operations require an employee to:
  - analyze non-standard situations;
  - make a decision.

### Need for an End-to-End Process

- The lending process is an end-to-end journey.
- Client interactions and internal application processing should be connected in one manageable process.
- A digital lending pipeline should:
  - preserve context between stages;
  - reduce repeated data entry;
  - provide the client with transparent application status information;
  - support the bank's efficient use of data.

### Target Audience

- The target user is a representative of a small or micro business who:
  - is looking for financing; or
  - submits an application on behalf of a company.
- Depending on the business structure, the user may be:
  - the business owner;
  - the CEO;
  - the CFO or accountant;
  - an employee responsible for financing;
  - an employee working with banking products;
  - another employee authorized to submit an application on behalf of the company.
- The solution should account for the possibility that the user has no banking expertise.
- The interface should help the user understand:
  - available options;
  - the current application status;
  - the next steps.
- The user should not need to understand the bank's internal processes.

## Task

### Main Objective

- Create a prototype of a digital lending pipeline for small and micro businesses.
- Combine the client journey and internal application processing into one process.

### Required Work

1. **Research the domain and user needs**
   - Identify the tasks small and micro businesses face when applying for lending products.

2. **Design the lending process model**
   - Define:
     - process boundaries;
     - stages;
     - participant actions;
     - required data;
     - possible outcomes.

3. **Implement the client's personal portal**
   - Allow the user to:
     - select the required lending product;
     - complete every stage from application submission to receiving the outcome.

4. **Design the bank-side request-processing stages**
   - Include:
     - the stages through which the application moves;
     - a model for making a lending decision.

5. **Combine all implemented components into a single functioning lending workflow**
   - Entered data must be saved.
   - The system must respond to user actions.
   - The system must dynamically display the application's state.

### Technical Requirements and Submission Format

- Prepare a set of materials that allows experts to launch the solution independently and complete the main scenario.

#### Repository and Versioning

- Publish the code in a GitHub repository with commit history.
- Specify the commit hash, tag, or another unambiguous identifier of the version available at the deadline.
- Commits made after the deadline will not be considered.
- If the repository is private, grant access to the jury account: `alfa-hack-2026`.

#### Deployment

- The solution must be cloud-native and run in Docker.
- Add Docker configuration.
- Provide one reproducible way to launch all required components on a regular PC.
- Publishing the solution in the cloud is additionally encouraged for demonstration purposes.

#### Dependencies and Environment

- Pin the versions of the programming language and key libraries by using:
  - lock files;
  - environment configuration;
  - or an equivalent mechanism.

#### Documentation

- Provide a `README.md` that includes:
  - the solution's purpose;
  - architecture;
  - environment requirements;
  - launch instructions;
  - configurations and environment variables;
  - a description of the components used;
  - a step-by-step verification scenario.
- Include the following in the repository:
  - an architecture diagram;
  - an API description;
  - OpenAPI/Swagger documentation;
  - a request collection;
  - an application state diagram;
  - a data model;
  - test scenarios.

#### Test Data and Third-Party Components

- Provide synthetic test data.
- If necessary, provide test accounts that allow reviewers to complete the end-to-end scenario.
- Add a `THIRD_PARTY_NOTICES` file listing:
  - third-party components;
  - models;
  - datasets;
  - services;
  - simulated integrations.

#### Additional Recommendation for the Demonstration

- It is additionally recommended to deploy the solution to a free external server in advance.
- During the demonstration, show:
  - how the news feed changes for the client;
  - what the news items contain.
- The solution must allow reviewers to interact with a working prototype rather than only view pre-prepared screens.

### Recommendations

1. **Begin with process research, not the interface**
   - Analyze the needs of the client and the bank.
   - Define the process boundaries.
   - Only then determine the set of screens and functions.

2. **Do not attempt to reproduce the entire banking lending process**
   - Select a realistic MVP.
   - Clearly explain which stages, roles, data, and checks are included and why.

3. **Use product research and prioritization tools only when they support a concrete decision**
   - Relevant tools may include:
     - Customer Development (`CustDev`);
     - Jobs to Be Done (`JTBD`);
     - user story mapping;
     - RICE;
     - ICE;
     - MoSCoW;
     - other suitable tools.
   - These tools should strengthen the solution rather than be used as a formality.

4. **Document the solution's key aspects**
   - Record:
     - architecture;
     - API description;
     - request collections;
     - test scenarios.
   - This will help experts understand and verify the solution.
   - It will also help the team develop the product further.

5. **Use AI only where it creates clear value**

## Success Criteria

### 1. Solution Integrity

- The prototype demonstrates a connected lending process from requesting a product to receiving an outcome.

### 2. Readiness for Review

- The main scenario can be verified.
- The team provides:
  - a working prototype;
  - clear launch instructions;
  - the required test data.

### 3. User Experience Quality

- The solution accounts for the needs of both the client and the bank.
- It helps participants understand the required actions at every stage.

### 4. Module Consistency

- The main modules are connected to each other.
- Data is saved and used throughout the process.
- The application state progresses sequentially through the process.

### 5. Enterprise Orientation

- The architecture, data handling, and dependencies account for the requirements of banking software development, including:
  - security;
  - reliability;
  - fault tolerance;
  - scalability;
  - maintenance.

### 6. Development Potential

- The team explains and substantiates:
  - the significance of its product and technical decisions;
  - the limitations of those decisions;
  - opportunities for further development.

### Additional Features

- Additional functionality is welcome if it creates value and does not replace a working main scenario.
- Such functionality may include:
  - automation;
  - AI assistants;
  - document recognition;
  - other mechanisms.

## Constraints

### 1. Solution Scope

- The solution must combine:
  - the client journey;
  - lending-process logic;
  - enterprise fintech development approaches.

### 2. Independence from Paid Resources

- The version submitted for review must not depend on:
  - paid subscriptions;
  - paid APIs;
  - purchased data;
  - restricted corporate licenses.
- Tools used only during development are not part of the version submitted for review.

### 3. Synthetic Data

- The demonstration must use synthetic data about:
  - clients;
  - companies;
  - employees;
  - documents;
  - applications;
  - financial metrics.
- The team must create its own test and demonstration data.

### 4. Autonomy

- The solution must not require access to Alfa-Bank's corporate systems.
- Required external checks and integrations must be reproduced using local:
  - mocks;
  - stubs;
  - simulators.

### 5. In-Product User Journey

- The primary user journey must take place inside the product.
- The following must not be part of completing the primary user journey:
  - email;
  - messaging apps;
  - phone calls;
  - SMS.

### 6. Permitted Simplifications

- A simplified lending-decision logic is allowed if it is clearly documented.
- Document signing and fund disbursement may be simulated without real transactions.
- External services may be reproduced in a reduced form as long as the purpose of the integration is preserved.
- All assumptions must preserve the meaning and coherence of the process.

### 7. Interface

- The client-facing part of the solution must have a web interface.
- Implementing the product as a mobile application is not allowed.

### 8. Use of Models

- If an LLM is used, only models with open weights are allowed.

## Solution Space

### Research and Validation

- The team independently selects methods for:
  - studying the domain;
  - validating assumptions.
- The solution should demonstrate a connection between:
  - identified needs;
  - selected scenarios;
  - the proposed solution.

### Components and Tools

- Ready-made components, existing models, and no-code/low-code tools are allowed if the team can:
  - explain the architecture;
  - demonstrate that the solution works.

### Lending-Process Coverage

- Depending on the selected scenario, the team may implement one or more stages of the lending process.
- The solution may include:
  - the client journey;
  - application processing;
  - work with data and documents;
  - checks;
  - interaction with banking roles;
  - decision support;
  - application tracking and servicing.

### Technology Selection

- Technologies should be selected with consideration for:
  - deployment in a corporate environment;
  - dependency control;
  - testing;
  - security;
  - reliability;
  - fault tolerance;
  - scalability;
  - future maintenance.

### External-Service Contracts

- External-service contracts and APIs may be simplified if the purpose and value of the integration are preserved.

### Artificial Intelligence

- AI is welcome but not mandatory.
- An AI assistant, LLM, document recognition, or another AI-based mechanism should:
  - solve a specific task;
  - create clear user or business value.

## Minimum End-to-End Lending Journey

### 1. Identifying the Financing Need and Creating an Application

- The lending journey begins with a business need for financing.
- The entrepreneur:
  - identifies the purpose for which funds are needed;
  - selects an appropriate lending product;
  - creates an application.
- At this stage, the bank receives the main request parameters, such as:
  - required amount;
  - term;
  - financing purpose.
- The bank also receives information about the client and the client's business.

### 2. Initial Internal Processing

- After submission, the application enters the bank's internal processing workflow.
- Information received from the client must be:
  - ingested;
  - checked for completeness;
  - checked for correctness;
  - converted into a form that can be used at later stages.
- If the available information is insufficient, the process may include clarification or supplementation.

### 3. Data Enrichment

- Data may be enriched with information from internal and external sources.
- One such source is a credit bureau.
- A credit history describes the payment discipline of an individual or organization and contains information about:
  - obligations;
  - outstanding debt;
  - payment performance.
- Additional company information may be obtained from government sources.
- The Unified State Register of Legal Entities (`EGRUL`) and the Unified State Register of Individual Entrepreneurs (`EGRIP`) can be used to confirm:
  - the existence and status of the business;
  - registration data;
  - types of business activities.
- The Russian Federal Tax Service's Transparent Business service also combines information about:
  - executives;
  - founders;
  - addresses;
  - Russian Classification of Economic Activities (`OKVED`) codes;
  - other characteristics of companies and individual entrepreneurs.

### 4. Scoring and Lending-Decision Logic

#### Difference Between Scoring and the Final Decision

- A scoring assessment and a lending decision are not the same thing.
- Scoring provides information about the level of risk.
- The final decision may take into account a broader set of factors, including:
  - product characteristics;
  - requested amount and term;
  - results of external checks;
  - available borrower data;
  - the bank's internal constraints and rules.
- The same risk assessment may therefore lead to different terms for different lending products.

#### Potential Scoring Factors

- Scoring is based on factors associated with the borrower's creditworthiness.
- For a business, these factors may include:
  - financial metrics;
  - income and expense information;
  - existing obligations;
  - loan repayment history;
  - application parameters;
  - other characteristics.
- Credit history may also be used as a source of risk-assessment data because it contains information about:
  - amounts and terms of obligations;
  - outstanding debt;
  - payment discipline.

#### Possible Scoring Approaches

- Scoring does not have to use a complex machine-learning model.
- Banking processes may use:
  - a set of formalized rules;
  - a points-based model;
  - a statistical model;
  - a rating;
  - a combination of automated assessment and expert analysis.
- More complex internal rating models used by banks to assess credit risk are evaluated, among other things, by their:
  - ability to distinguish between borrowers with different risk levels;
  - accuracy;
  - stability of results.

#### Example of Simplified Scoring Logic

- Each significant attribute may have a defined effect on the final assessment.
- The combined factors then produce an outcome.
- Stable finances and a positive repayment history may lower the assessed risk.
- The following may raise the assessed risk:
  - a high debt burden;
  - unstable financial performance;
  - overdue payments.

### 5. Possible Lending Outcomes

- The outcome of a lending review does not have to be binary.
- In addition to approval or rejection, the bank may be ready to provide financing on different terms, for example by:
  - changing the financing amount;
  - changing the financing term;
  - offering another product;
  - requesting additional information to refine the assessment.

### 6. Role of Scoring in the Lending Pipeline

- Scoring should be treated as one component of the lending pipeline.
- Client and application data enters the pipeline.
- The data passes through checks and analysis.
- It is transformed into a risk assessment.
- Lending logic then determines:
  - the appropriate decision;
  - the next actions corresponding to the result.

### 7. End of the Process

- The process may result in:
  - an offer of financing terms;
  - a need for additional information or clarification;
  - a negative decision.
- A positive decision is followed by:
  - preparation and execution of the required documents;
  - subsequent financing operations.
- The set of intermediate stages depends on:
  - the product;
  - the client's specific circumstances.

## Credits

- The case was written and published by `Changellenge >>`, a leading case-study organization in Russia.
- The case was created jointly with JSC Alfa-Bank.
- Websites:
  - [changellenge.com](https://www.changellenge.com)
  - [alfabank.ru](https://www.alfabank.ru)
