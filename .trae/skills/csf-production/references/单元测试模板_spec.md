# Java单元测试标准模板
> **变量定义引用**：本规范中使用的变量（如 `{businessCenter}`、`{domain}`、`{module}`、`{EntityName}`、`{author}`、`{REQUIRED_PARAM}` 等）请参考 [变量命名_spec.md](变量命名_spec.md) 文件获取具体值。

## 概述
这是一个标准的Java单元测试模板，用于测试根据<<接口服务层-spec.md>>规则生成的CRUD操作。模板包含了完整的测试结构和最佳实践。

```
必须生成在单元测试得路径下 没有就新建
```

## 模板结构

### 1. 基本框架

```markdown
package com.asiainfo.{domain}.center.{module}.interfaces;

import com.asiainfo.{domain}.center.{module}.interfaces.I{EntityName}CSV;
import org.junit.Before;
import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.*;

public class {ServiceName}CSVImplTest {
    
    private I{EntityName}CSV {EntityName}CSV;
    
    @Before
    public void setUp() throws Exception {
        {EntityName}CSV = new {EntityName}CSVImpl();
    }
    
    // 测试方法...
}
```

### 2. 查询方法测试模板

#### 2.1 正常查询测试

```java
@Test
public void test{EntityName}WithValidInput() throws Exception {
    // 准备测试数据
    Map<String, Object> input = new HashMap<>();
    //根据主键或者表字段自行填充
    input.put("[KEY_NAME]", "[test_value]");
    
    // 执行查询
    Map result = {EntityName}CSV.query{EntityName}(input);
    System.out.println(result);
    
    // 可选：添加断言验证结果
    // assertNotNull(result);
}
```

#### 2.2 空输入异常测试

```java
@Test(expected = Exception.class)
public void test{EntityName}WithEmptyInput() throws Exception {
    // 测试空输入异常
    {EntityName}CSV.query{EntityName}(new HashMap<>());
}
```

### 3. 计数查询测试模板

```java
@Test
public void testCount{EntityName}WithValidInput() throws Exception {
    // 准备测试数据
    Map<String, Object> input = new HashMap<>();
      //根据主键字段自行填充
    input.put("[FILTER_KEY]", "[filter_value]");
    
    // 执行计数查询
    Map result = {EntityName}CSV.query{EntityName}Count(input);
    
    // 验证结果
    assertNotNull(result);
    assertTrue(result.containsKey("COUNT"));
    assertTrue(result.get("COUNT") instanceof Integer);
}

@Test(expected = Exception.class)
public void testCount{EntityName}WithEmptyInput() throws Exception {
    // 测试空输入异常
    {EntityName}CSV.query{EntityName}Count(new HashMap<>());
}
```

### 4. 保存方法测试模板

```java
@Test
public void testSave{EntityName}WithValidInput() throws Exception {
    // 准备测试数据
    Map<String, Object> input = new HashMap<>();
    input.put("{主键}", [test_id]);
      //根据表字段自行填充
    input.put("[FIELD_NAME]", "[field_value]");
    input.put("[FIELD_NAME_2]", "[field_value_2]");
    
    // 执行保存操作（不抛异常即成功）
     {EntityName}CSV.save{EntityName}(input);
    
    // 验证：如果执行到这里没有异常，说明保存成功
    assertTrue(true);
}

@Test(expected = Exception.class)
public void testSave{EntityName}WithEmptyInput() throws Exception {
    // 测试空输入异常
    {EntityName}CSV.save{EntityName}(new HashMap<>());
}
```

### 5. 更新方法测试模板

```java
@Test
public void testUpdate{EntityName}WithValidInput() throws Exception {
    // 准备测试数据
    Map<String, Object> input = new HashMap<>();
    input.put("{主键}", [existing_id]);
      //根据主键或者表字段自行填充
    input.put("[UPDATE_FIELD]", "[new_value]");
    input.put("[UPDATE_FIELD_2]", "[new_value_2]");
    
    // 执行更新操作（不抛异常即成功）
    {EntityName}CSV.update{EntityName}(input);
    
    // 验证：如果执行到这里没有异常，说明更新成功
    assertTrue(true);
}

@Test(expected = Exception.class)
public void test[Update{EntityName}]WithEmptyInput() throws Exception {
    // 测试空输入异常
    {EntityName}CSV.update{EntityName}(new HashMap<>());
}
```

### 6. 删除方法测试模板

```java
@Test
public void test[Delete{EntityName}]WithValidInput() throws Exception {
    // 准备测试数据
    Map<String, Object> input = new HashMap<>();
    input.put("{主键}", [target_id]);
    
    // 执行删除操作（不抛异常即成功）
    {EntityName}CSV.delete{EntityName}(input);
    
    // 验证：如果执行到这里没有异常，说明删除成功
    assertTrue(true);
}

@Test(expected = Exception.class)
public void test[DeleteMethodName]WithEmptyInput() throws Exception {
    // 测试空输入异常
     {EntityName}CSV.delete{EntityName}(new HashMap<>());
}
```

## 模板使用说明

### 测试数据准备原则

1. **有效输入测试**：提供符合业务逻辑的完整测试数据
2. **边界值测试**：测试空值、null值、边界条件
3. **异常输入测试**：测试空Map、缺少必要参数等异常情况

### 断言验证建议

1. **查询方法**：验证返回结果不为null，包含预期字段
2. **计数方法**：验证返回结果包含COUNT字段且为Integer类型
3. **增删改方法**：验证方法执行不抛异常（简单验证）

