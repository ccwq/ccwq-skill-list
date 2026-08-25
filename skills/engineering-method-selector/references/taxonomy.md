# 分类与路由参考

## Method types

- **Pattern**：结构解决方案，改变系统或代码的组织方式，例如 Repository、CQRS、Circuit Breaker。
- **Practice**：可重复的工程实践，例如 TDD、BDD、Code Review、ADR。
- **Process**：跨角色或跨阶段的流程体系，例如 Incident Response、Postmortem、Release Process。
- **Heuristic**：帮助快速取舍的经验规则，例如 DRY、KISS、YAGNI。

## Activities

| activity | 典型产物 | 常见质量属性 |
|---|---|---|
| requirement | requirement, user_story, acceptance_criteria | maintainability, reliability |
| design | design_doc, adr, rfc | scalability, security, performance, maintainability |
| coding | source_code, code_comment | maintainability, reliability |
| testing | test_case, test_strategy, test_result | reliability, security |
| debug | incident_report, log, experiment | reliability, observability, performance |
| review | review, adr, code_comment | maintainability, security |
| operation | runbook, incident_report, production_signal | reliability, observability, cost |
| ai_engineering | task_contract, context_handoff, verification_record | reliability, maintainability, observability |
| decision | decision_matrix, adr, benchmark | cost, performance, scalability, security |

## Quality attribute selection

先选真正会改变取舍的属性，不要把所有属性都列上：

- `performance`：延迟、吞吐、资源使用是主要成功标准。
- `reliability`：失败恢复、正确性或可用性优先。
- `security`：威胁、权限、机密性或完整性影响结论。
- `maintainability`：变更成本、理解成本或边界清晰度是瓶颈。
- `scalability`：负载、数据量或团队规模会继续增长。
- `observability`：没有证据定位或验证运行时行为。
- `cost`：基础设施、人工或迁移成本需要显式权衡。
