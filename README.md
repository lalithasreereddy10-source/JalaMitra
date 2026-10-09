# JalaMitra — Smart Water Allocation for a Sustainable Future

**Quantum Computing Hackathon — Use Case 03: Irrigation and Water-Resource Allocation Optimisation**
**Target Region:** Krishna-Godavari Command Areas, Andhra Pradesh, India.

---

## 1. Executive Summary
Water scarcity in major multi-reservoir systems such as the Krishna and Godavari river basins is exacerbated by erratic monsoons, upstream impoundments, competing cropping calendars, and canal conveyance losses. 

**JalaMitra** is an end-to-end multilingual decision support platform designed for Water Resources Department officers, canal superintendents, and agricultural planners. It combines:
1. **Classical Linear & Constrained Optimisation:** Respects minimum dead storage, maximum permissible dam discharge, canal conveyance capacities, and delivery efficiencies.
2. **QUBO & QAOA Quantum Optimisation (Quantum Lab):** Encodes discrete multi-tranche irrigation allocations as a Quadratic Unconstrained Binary Optimization problem, solvable on NISQ quantum hardware using the Quantum Approximate Optimisation Algorithm (QAOA).
3. **JalaMitra Advisor (Gemini AI Integration):** Server-side LLM intelligence explaining bottlenecks, drought mitigation strategies, and mathematical rationale in plain language.
4. **Interactive GIS Command Map:** Visualizes key reservoirs (Srisailam, Nagarjuna Sagar, Prakasam Barrage, Sir Arthur Cotton Barrage, Polavaram) and distribution canals with risk status indicators.
5. **Universal 23-Language Multilingual System:** Full native-script interface and right-to-left layout supporting English and all 22 scheduled Indian languages.

---

## 2. Mathematical Formulations

### A. Classical Allocation Model
Let:
- $R$ be the set of reservoirs, with available water $S_r$, minimum dead storage $S_r^{\min}$, and max release limit $D_r^{\max}$.
- $C$ be the set of canals, with capacity $K_c$ and conveyance efficiency $\eta_c \in (0, 1]$.
- $Z$ be the set of irrigation zones or crops, with area $A_i$ (ha), water demand $D_i$ (MCM), priority $w_i \in [1, 5]$, and allocation bounds $[x_i^{\min}, D_i]$.

**Objective Function:**
$$\max \sum_{i \in Z} w_i \cdot x_i - \lambda_{\text{shortage}} \sum_{i \in Z} (D_i - x_i)^2 - \lambda_{\text{fairness}} \text{Var}\left(\frac{x_i}{D_i}\right)$$

**Subject to:**
1. $\sum_{i \in Z(r)} \frac{x_i}{\eta_{c(i)}} \le \min\left( S_r - S_r^{\min}, D_r^{\max} \right) \quad \forall r \in R$
2. $\sum_{i \in Z(c)} \frac{x_i}{\eta_c} \le K_c \quad \forall c \in C$
3. $x_i^{\min} \le x_i \le D_i \quad \forall i \in Z$

### B. QUBO & QAOA Formulation (Quantum Lab)
To solve on a quantum computer or simulator:
1. Discretize each zone's allocation into binary tranches $b_{i,k} \in \{0, 1\}$:
   $$x_i = \sum_{k=1}^K \Delta_{i,k} b_{i,k}$$
2. The Hamiltonian cost function is formulated as:
   $$H(b) = - \sum_{i, k} w_i \Delta_{i,k} b_{i,k} + P_{\text{supply}} \left(\sum_{i,k} \Delta_{i,k} b_{i,k} - W_{\text{available}}\right)^2 + P_{\text{fairness}} \sum_{i < j} \left( \frac{x_i}{D_i} - \frac{x_j}{D_j} \right)^2$$
3. Expansion gives standard QUBO form:
   $$\min_{b \in \{0, 1\}^N} b^T Q b$$
4. Solved via QAOA ansatz parameterized by angle vectors $(\vec{\gamma}, \vec{\beta})$ with depth $p$:
   $$|\psi(\vec{\gamma}, \vec{\beta})\rangle = \prod_{l=1}^p e^{-i \beta_l H_M} e^{-i \gamma_l H_C} |+\rangle^{\otimes N}$$

---

## 3. Honest Quantum Disclaimers & Assumptions
- **No Unproven Quantum Supremacy:** The quantum demonstration illustrates QUBO mapping and variational ansatz evaluation. Modern classical solvers easily solve this scale in milliseconds. Quantum advantage for combinatorial water routing remains an open research frontier for large-scale, multi-reservoir networks with hundreds of canals.
- **Data Disclaimer:** Initial reservoir storage values, canal capacities, and crop demands are realistic simulated demonstration figures calibrated for the Krishna-Godavari command areas. They do not constitute official real-time telemetry from the Central Water Commission (CWC) or AP Water Resources Department.

---

## 4. How to Run the Standalone Python Qiskit Script
```bash
# 1. Install prerequisites
pip install qiskit qiskit-optimization qiskit-aer numpy

# 2. Execute script
python qiskit_qaoa_water_allocator.py
```
