---
name: activiti-workflow-generator
description: 根据 Activiti 工作流定义（BPMN XML）生成可执行的 SQL 脚本，或将数据库中的流程配置导出为 SQL 文件。支持 CFG_PROCESS、CFG_TASK、CFG_TASK_CHANGE 等表的完整 INSERT 语句生成。Use when working with Activiti workflow definitions, process tables, task configuration, or when the user mentions BPMN to SQL, workflow export, or database script generation.
---

# Activiti 工作流 SQL 生成器

## 概述

本技能用于在 ESOP 项目中实现：
1. **将 BPMN XML 流程定义转换为可执行的 SQL 脚本**
2. **将数据库中的流程配置导出为标准 INSERT 语句**
3. **批量生成流程相关的完整数据库脚本**

### 核心表结构

基于以下数据库表进行工作流管理：

1. **CFG_PROCESS** - 流程定义表
2. **CFG_TASK** - 任务定义表  
3. **CFG_TASK_CHANGE** - 任务字段变更配置表

## 数据库表结构说明

### CFG_PROCESS（流程表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| PROCESS_ID | NUMBER(12) | 主键 ID |
| PROCESS_KEY | VARCHAR2(128) | 流程定义 Key（对应 BPMN 的 process id） |
| PROCESS_NAME | VARCHAR2(128) | 流程名称 |
| BUSI_ID | NUMBER(12) | 页面 ID |
| PROCESS_TYPE | NUMBER(2) | 流程类型：1-普通流程，2-独立流程，3-任务型流程 |
| REMARK | VARCHAR2(4000) | 备注 |
| STATE | VARCHAR2(2) | 状态 |
| OP_ID | NUMBER(12) | 操作员 ID |
| ORG_ID | NUMBER(12) | 组织 ID |
| DONE_DATE | DATE | 完成时间 |
| EXT1-EXT4 | Various | 扩展字段 |
| BUSI_ROLE | VARCHAR2(128) | 页面角色 |

### CFG_TASK（任务表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| TASK_ID | NUMBER(12) | 主键 ID |
| TASK_NAME | VARCHAR2(128) | 任务名称 |
| PROCESS_KEY | VARCHAR2(128) | 关联的流程定义 Key |
| TASK_KEY | VARCHAR2(128) | 任务定义 Key（对应 BPMN 的 task id） |
| TASK_TYPE | NUMBER(2) | 任务类型 |
| PROCESS_ID | NUMBER(12) | 关联的流程 ID |
| BUSI_ID | NUMBER(12) | 页面 ID |
| REMARK | VARCHAR2(4000) | 备注 |
| STATE | VARCHAR2(2) | 状态 |
| PLAN_TIME | VARCHAR2(128) | 任务计划时间（如：3Y,2M,1D,6H,8MIN,10S） |
| ENDTIME_CLASS | VARCHAR2(150) | 结束时间类 |
| AUTO_TRANFORM_TIME | VARCHAR2(128) | 自动转排时间 |
| BUSI_ROLE | VARCHAR2(128) | 页面角色 |

### CFG_TASK_CHANGE（任务变更配置表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| TASK_ID | NUMBER(12) | 关联的任务 ID |
| FIELD_ID | VARCHAR2(64) | 字段 ID（联合主键） |
| FIELD_NAME | VARCHAR2(256) | 字段名称 |
| FIELD_TYPE | NUMBER(2) | 字段类型：1-String, 2-Long, 3-Integer, 4-Double |
| DEFAULT_VALUE | VARCHAR2(256) | 默认值 |
| REMARK | VARCHAR2(4000) | 备注 |

## 输出说明

### 生成的 SQL 文件格式

```sql
-- ============================================================================
-- 流程名称：${PROCESS_NAME}
-- 流程 Key: ${PROCESS_KEY}
-- 生成时间：${GENERATE_TIME}
-- 包含内容：流程定义、任务节点、字段配置
-- ============================================================================

-- 删除已存在的流程数据（如果需要）
DELETE FROM AIESOP.CFG_TASK_CHANGE WHERE TASK_ID IN (
    SELECT TASK_ID FROM AIESOP.CFG_TASK WHERE PROCESS_KEY = '${PROCESS_KEY}'
);
DELETE FROM AIESOP.CFG_TASK WHERE PROCESS_KEY = '${PROCESS_KEY}';
DELETE FROM AIESOP.CFG_PROCESS WHERE PROCESS_KEY = '${PROCESS_KEY}';

-- 1. 插入流程定义
INSERT INTO AIESOP.CFG_PROCESS (
    PROCESS_ID,
    PROCESS_KEY,
    PROCESS_NAME,
    BUSI_ID,
    PROCESS_TYPE,
    REMARK,
    STATE,
    OP_ID,
    ORG_ID,
    DONE_DATE,
    EXT1,
    EXT2,
    EXT3,
    EXT4,
    BUSI_ROLE
) VALUES (
    ${PROCESS_ID},
    '${PROCESS_KEY}',
    '${PROCESS_NAME}',
    ${BUSI_ID},
    ${PROCESS_TYPE},
    '${REMARK}',
    '${STATE}',
    ${OP_ID},
    ${ORG_ID},
    TO_DATE('${DONE_DATE}', 'YYYY-MM-DD HH24:MI:SS'),
    ${EXT1},
    ${EXT2},
    '${EXT3}',
    '${EXT4}',
    '${BUSI_ROLE}'
);

-- 2. 插入任务节点
INSERT INTO AIESOP.CFG_TASK (
    TASK_ID,
    TASK_NAME,
    PROCESS_KEY,
    TASK_KEY,
    TASK_TYPE,
    PROCESS_ID,
    BUSI_ID,
    REMARK,
    STATE,
    OP_ID,
    ORG_ID,
    DONE_DATE,
    PLAN_TIME,
    EXT1,
    EXT2,
    EXT3,
    EXT4,
    BUSI_ROLE,
    ENDTIME_CLASS,
    AUTO_TRANFORM_TIME
) VALUES (
    ${TASK_ID},
    '${TASK_NAME}',
    '${PROCESS_KEY}',
    '${TASK_KEY}',
    ${TASK_TYPE},
    ${PROCESS_ID},
    ${BUSI_ID},
    '${REMARK}',
    '${STATE}',
    ${OP_ID},
    ${ORG_ID},
    TO_DATE('${DONE_DATE}', 'YYYY-MM-DD HH24:MI:SS'),
    '${PLAN_TIME}',
    ${EXT1},
    ${EXT2},
    '${EXT3}',
    '${EXT4}',
    '${BUSI_ROLE}',
    '${ENDTIME_CLASS}',
    '${AUTO_TRANFORM_TIME}'
);

-- 3. 插入任务字段配置
INSERT INTO AIESOP.CFG_TASK_CHANGE (
    TASK_ID,
    FIELD_ID,
    FIELD_NAME,
    FIELD_TYPE,
    DEFAULT_VALUE,
    REMARK,
    STATE,
    OP_ID,
    ORG_ID,
    DONE_DATE,
    EXT1,
    EXT2,
    EXT3,
    EXT4
) VALUES (
    ${TASK_ID},
    '${FIELD_ID}',
    '${FIELD_NAME}',
    ${FIELD_TYPE},
    '${DEFAULT_VALUE}',
    '${REMARK}',
    '${STATE}',
    ${OP_ID},
    ${ORG_ID},
    TO_DATE('${DONE_DATE}', 'YYYY-MM-DD HH24:MI:SS'),
    ${EXT1},
    ${EXT2},
    '${EXT3}',
    '${EXT4}'
);
```

## 反向解析：BPMN XML → 数据库

### 解析工作流程

```markdown
Task Progress:
- [ ] 步骤 1: 读取并解析 BPMN XML 文件
- [ ] 步骤 2: 提取流程定义信息（PROCESS_KEY, PROCESS_NAME 等）
- [ ] 步骤 3: 提取所有任务节点（UserTask、ServiceTask 等）
- [ ] 步骤 4: 提取流转关系（SequenceFlow）
- [ ] 步骤 5: 保存到 CFG_PROCESS 表
- [ ] 步骤 6: 保存到 CFG_TASK 表
- [ ] 步骤 7: 保存到 CFG_TASK_CHANGE 表
```

### XML 解析代码示例

```java
/**
 * 解析 BPMN XML 并保存到数据库
 */
@Transactional
public void parseBpmnXml(String bpmnXml) throws Exception {
    // 1. 解析 XML
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    DocumentBuilder builder = factory.newDocumentBuilder();
    Document document = builder.parse(new InputSource(new StringReader(bpmnXml)));
    
    // 2. 提取流程信息
    NodeList processNodes = document.getElementsByTagName("process");
    Element processElement = (Element) processNodes.item(0);
    
    CfgProcessEntity process = new CfgProcessEntity();
    process.setProcessKey(processElement.getAttribute("id"));
    process.setProcessName(processElement.getAttribute("name"));
    process.setProcessType(1); // 默认普通流程
    process.setState("1");
    process.setDoneDate(new Date());
    
    // 保存流程
    cfgProcessDao.insert(process);
    
    // 3. 提取任务节点
    NodeList taskNodes = document.getElementsByTagName("userTask");
    for (int i = 0; i < taskNodes.getLength(); i++) {
        Element taskElement = (Element) taskNodes.item(i);
        
        CfgTaskEntity task = new CfgTaskEntity();
        task.setTaskId(generateId());
        task.setProcessKey(process.getProcessKey());
        task.setTaskKey(taskElement.getAttribute("id"));
        task.setTaskName(taskElement.getAttribute("name"));
        
        // 获取候选组
        String candidateGroups = taskElement.getAttribute("activiti:candidateGroups");
        if (StringUtils.isNotBlank(candidateGroups)) {
            task.setBusiRole(candidateGroups);
        }
        
        task.setState("1");
        task.setDoneDate(new Date());
        
        // 保存任务
        cfgTaskDao.insert(task);
    }
    
    // 4. 提取流转关系
    NodeList flowNodes = document.getElementsByTagName("sequenceFlow");
    for (int i = 0; i < flowNodes.getLength(); i++) {
        // 处理流转关系
        // TODO: 根据业务需求保存流转配置
    }
}
```

## 关键映射关系

### 流程类型映射

| CFG_PROCESS.PROCESS_TYPE | Activiti 流程类型 | 说明 |
|--------------------------|------------------|------|
| 1 | 普通流程 | 标准审批流程 |
| 2 | 独立流程 | 可独立运行的子流程 |
| 3 | 任务型流程 | 仅包含任务集合，无复杂流转 |

### 任务类型映射

| CFG_TASK.TASK_TYPE | Activiti 任务类型 | BPMN 元素 |
|--------------------|------------------|-----------|
| 1 | UserTask | `<userTask>` |
| 2 | ServiceTask | `<serviceTask>` |
| 3 | ManualTask | `<manualTask>` |
| 4 | ScriptTask | `<scriptTask>` |

### 时间表达式映射

| CFG_TASK.PLAN_TIME | Activiti 定时器 | 说明 |
|--------------------|----------------|------|
| 3Y | P3Y | 3 年 |
| 2M | P2M | 2 个月 |
| 1D | P1D | 1 天 |
| 6H | PT6H | 6 小时 |
| 8MIN | PT8M | 8 分钟 |
| 10S | PT10S | 10 秒 |

## 完整示例

### 示例 1：请假流程

#### 数据库数据

```sql
-- 流程定义
INSERT INTO AIESOP.CFG_PROCESS (
    PROCESS_ID, PROCESS_KEY, PROCESS_NAME, PROCESS_TYPE, STATE, DONE_DATE
) VALUES (
    1001, 'leaveProcess', '员工请假流程', 1, '1', SYSDATE
);

-- 任务节点
INSERT INTO AIESOP.CFG_TASK (
    TASK_ID, TASK_KEY, TASK_NAME, PROCESS_KEY, TASK_TYPE, BUSI_ROLE, STATE, DONE_DATE
) VALUES (
    2001, 'applyTask', '提交申请', 'leaveProcess', 1, 'EMPLOYEE', '1', SYSDATE
);

INSERT INTO AIESOP.CFG_TASK (
    TASK_ID, TASK_KEY, TASK_NAME, PROCESS_KEY, TASK_TYPE, BUSI_ROLE, STATE, DONE_DATE
) VALUES (
    2002, 'managerApprove', '经理审批', 'leaveProcess', 1, 'MANAGER', '1', SYSDATE
);

INSERT INTO AIESOP.CFG_TASK (
    TASK_ID, TASK_KEY, TASK_NAME, PROCESS_KEY, TASK_TYPE, BUSI_ROLE, STATE, DONE_DATE
) VALUES (
    2003, 'hrTask', 'HR 备案', 'leaveProcess', 1, 'HR', '1', SYSDATE
);

-- 任务字段配置
INSERT INTO AIESOP.CFG_TASK_CHANGE (
    TASK_ID, FIELD_ID, FIELD_NAME, FIELD_TYPE, DEFAULT_VALUE, STATE
) VALUES (
    2001, 'leaveDays', '请假天数', 3, '1', '1'
);

INSERT INTO AIESOP.CFG_TASK_CHANGE (
    TASK_ID, FIELD_ID, FIELD_NAME, FIELD_TYPE, DEFAULT_VALUE, STATE
) VALUES (
    2001, 'reason', '请假原因', 1, '', '1'
);
```

#### 生成的 BPMN XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:activiti="http://activiti.org/bpmn"
             targetNamespace="http://www.activiti.org/processdef">

  <process id="leaveProcess" name="员工请假流程" isExecutable="true">
    <documentation>员工请假审批流程</documentation>
    
    <!-- 开始事件 -->
    <startEvent id="start" name="开始"/>
    
    <!-- 提交申请 -->
    <userTask id="applyTask" name="提交申请" activiti:candidateGroups="EMPLOYEE">
      <documentation>员工填写请假申请</documentation>
    </userTask>
    
    <!-- 经理审批 -->
    <userTask id="managerApprove" name="经理审批" activiti:candidateGroups="MANAGER">
      <documentation>部门经理审批</documentation>
    </userTask>
    
    <!-- HR 备案 -->
    <userTask id="hrTask" name="HR 备案" activiti:candidateGroups="HR">
      <documentation>人力资源备案</documentation>
    </userTask>
    
    <!-- 结束事件 -->
    <endEvent id="end" name="结束"/>
    
    <!-- 流转关系 -->
    <sequenceFlow id="flow1" sourceRef="start" targetRef="applyTask"/>
    <sequenceFlow id="flow2" sourceRef="applyTask" targetRef="managerApprove"/>
    <sequenceFlow id="flow3" sourceRef="managerApprove" targetRef="hrTask"/>
    <sequenceFlow id="flow4" sourceRef="hrTask" targetRef="end"/>
  </process>
  
  <bpmndi:BPMNDiagram id="BPMNDiagram_leaveProcess">
    <bpmndi:BPMNPlane bpmnElement="leaveProcess" id="BPMNPlane_leaveProcess">
      <bpmndi:BPMNShape bpmnElement="start" id="BPMNShape_start">
        <omgdc:Bounds x="100" y="100" width="50" height="50"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape bpmnElement="applyTask" id="BPMNShape_applyTask">
        <omgdc:Bounds x="200" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape bpmnElement="managerApprove" id="BPMNShape_managerApprove">
        <omgdc:Bounds x="350" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape bpmnElement="hrTask" id="BPMNShape_hrTask">
        <omgdc:Bounds x="500" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape bpmnElement="end" id="BPMNShape_end">
        <omgdc:Bounds x="650" y="100" width="50" height="50"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
```

## 工具类参考

### FSV服务接口

如需对外提供工作流生成服务，可创建 FSV 接口：

```java
// FSV 接口
package com.asiainfo.esop.core.workflow.interfaces;

public interface IWorkflowFSV {
    /**
     * 根据流程 Key 生成 BPMN XML
     */
    String generateBpmn(String param) throws Exception;
    
    /**
     * 解析 BPMN XML 并保存到数据库
     */
    String parseBpmn(String param) throws Exception;
}

// FSV实现
package com.asiainfo.esop.core.workflow.impl;

@Service(protocol = {"dubbo"}, interfaceClass = IWorkflowFSV.class)
public class WorkflowFSVImpl implements IWorkflowFSV {
    
    @Autowired
    private IWorkflowSV workflowSV;
    
    @Override
    public String generateBpmn(String param) throws Exception {
        Response response = new Response();
        try {
            Map<String, Object> map = JsonUtil.json2Map(param);
            String processKey = map.get("processKey").toString();
            
            String bpmnXml = workflowSV.generateBpmnXml(processKey);
            
            response.setCode(Response.SUCCESS);
            response.setData(JsonUtil.json2Map(bpmnXml));
        } catch (Exception e) {
            logger.error("生成 BPMN 失败:", e);
            response.setCode(Response.ERROR);
            response.setMessage("生成失败：" + e.getMessage());
        }
        return response.toString();
    }
    
    @Override
    public String parseBpmn(String param) throws Exception {
        Response response = new Response();
        try {
            Map<String, Object> map = JsonUtil.json2Map(param);
            String bpmnXml = map.get("bpmnXml").toString();
            
            workflowSV.parseBpmnXml(bpmnXml);
            
            response.setCode(Response.SUCCESS);
            response.setMessage("解析成功");
        } catch (Exception e) {
            logger.error("解析 BPMN 失败:", e);
            response.setCode(Response.ERROR);
            response.setMessage("解析失败：" + e.getMessage());
        }
        return response.toString();
    }
}
```

## 验证规则

### BPMN XML 合法性检查

1. ✅ 根元素必须是 `<definitions>`
2. ✅ 必须包含 `process` 元素
3. ✅ `process` 必须有唯一的 `id` 和 `name`
4. ✅ 至少包含一个开始事件和一个结束事件
5. ✅ 所有任务节点必须有唯一的 `id`
6. ✅ `sequenceFlow` 的 `sourceRef` 和 `targetRef` 必须引用存在的节点
7. ✅ 流程必须是连通的（从开始到结束有路径）

### 数据库完整性检查

1. ✅ CFG_PROCESS.PROCESS_KEY 必须唯一
2. ✅ CFG_TASK.PROCESS_KEY 必须存在于 CFG_PROCESS
3. ✅ CFG_TASK_CHANGE.TASK_ID 必须存在于 CFG_TASK
4. ✅ 所有必填字段不能为空
5. ✅ 状态字段必须符合枚举值

## 常见问题 FAQ

### Q1: 如何处理并行网关？

**A**: 在 CFG_TASK 中增加 GATEWAY_TYPE 字段标识网关类型：

```sql
ALTER TABLE AIESOP.CFG_TASK ADD GATEWAY_TYPE NUMBER(2);
-- 1: 并行网关，2: 排他网关，3: 包容网关
```

生成 BPMN 时：

```xml
<parallelGateway id="parallelFork" name="并行分支"/>
<sequenceFlow id="flow1" sourceRef="task1" targetRef="parallelFork"/>
<sequenceFlow id="flow2" sourceRef="parallelFork" targetRef="task2"/>
<sequenceFlow id="flow3" sourceRef="parallelFork" targetRef="task3"/>
```

### Q2: 如何配置任务监听器？

**A**: 使用 CFG_TASK_CHANGE 存储监听器配置：

```xml
<userTask id="task1" name="任务 1">
  <extensionElements>
    <activiti:taskListener event="create" class="com.example.TaskCreateListener"/>
    <activiti:taskListener event="complete" class="com.example.TaskCompleteListener"/>
  </extensionElements>
</userTask>
```

### Q3: 如何处理会签？

**A**: 在 CFG_TASK 中增加 MULTI_INSTANCE 配置：

```xml
<userTask id="task1" name="会签任务">
  <multiInstanceLoopCharacteristics isSequential="false">
    <loopCardinality>${assigneeList.size()}</loopCardinality>
    <loopDataInputRef>assigneeList</loopDataInputRef>
    <inputDataItem name="assignee"/>
    <completionCondition>${nrOfCompletedInstances/nrOfInstances >= 0.8}</completionCondition>
  </multiInstanceLoopCharacteristics>
</userTask>
```

## 相关资源

- [Activiti 官方文档](https://www.activiti.org/userguide/)
- [BPMN 2.0 规范](http://www.omg.org/spec/BPMN/2.0/)
- [ESOP 项目编码规范](./esopappRule.md)
- [数据库建表规范](./DatabaseTableSpec.md)
