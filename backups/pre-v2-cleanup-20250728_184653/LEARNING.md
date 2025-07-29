# LEARNING.md

## Timeboxed Iterative AI Development

### What is it?
Timeboxed, iterative AI development is a workflow where each major blocker or debugging task is addressed in a series of limited, focused attempts (typically up to 3 iterations). After 3 unsuccessful attempts, the team pauses to reassess, skip, or remove the problematic test/feature, or escalate for review.

### Why use it?
- Prevents endless loops on a single blocker
- Encourages rapid learning and adaptation
- Ensures progress even when a solution is not immediately found
- Makes AI-assisted development more predictable and manageable

### How to apply
1. **Identify a blocker or failing test.**
2. **Attempt a fix or diagnostic patch.**
3. **Rerun the relevant tests and observe results.**
4. **If not resolved, iterate with a new hypothesis or approach (up to 3 times).**
5. **After 3 attempts:**
   - If still failing, document findings and either skip/remove the test, or escalate for human review.
   - Update the working checklist and commit progress.

### Example Workflow
- Patch orchestrator to add schema/table checks (iteration 1)
- Add pre-function call table existence check (iteration 2)
- Log and test function SQL quoting (iteration 3)
- If still failing, skip test and document for follow-up

### Benefits
- Maintains momentum in AI-driven development
- Reduces frustration and wasted cycles
- Creates a clear audit trail for future contributors

---

_This practice is now standard for all AI-assisted development and debugging in this project._ 