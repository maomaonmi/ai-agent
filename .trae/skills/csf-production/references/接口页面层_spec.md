# CRM订单中心接口页面层(CSV层)代码生成规范

## 一、概述

本规范专门针对业务中心的CSV层代码生成。CSV层是订单中心对外提供服务的接口层，负责接收外部请求、参数校验、调用SV层服务并返回结果。

> **变量定义引用**：本规范中使用的变量（如 `{businessCenter}`、`{domain}`、`{module}`、`{EntityName}`、`{author}`、`{REQUIRED_PARAM}` 等）请参考 [变量命名_spec.md](变量命名_spec.md) 文件获取具体值。

### 1.1 目录结构



- `{businessCenter}`： 业务中心（如： ordercenter）
- `{domain}`：中心简称（如order、user、product等）
- `{module}`：业务模块名称。表名小写（如channel、productorderrecord等）
- `{EntityName}`：表名的驼峰式命名（如ProductOrderRecord）

```
{businessCenter}/
└── src/
    └── main/
        └── java/
           └── com/
             └── cmi/
                └── {domain}/
                    └── csf/
                        │
                        ├── interfaces/              # 接口定义
                        │   └── I{EntityName}CSV.java
                        └── impl/                    # 接口实现
                        │       └── {EntityName}CSVImpl.java
                        └── business/
                            └── {module}                    # 通用服务目录
                                ├── interfaces/
                                │   └── I{EntityName}BizSV.java
                                └── impl/
                                    └── {EntityName}BizSVImpl.java
    
```

### 1.2 常用中心（businessCenter)

- **ordercenter**: 订单中心
详见《CRM 系统整体架构说明文档-V1.md》2.2 业务中心  2.3 专业中心
### 1.3 常用中心简称(domain)

  - **order**: 订单相关
  - **cust**: 客户相关

### 1.4 常用业务模块(module)

  - **handleList**: 受理相关
  - **billingVisualization**: 出账可视化相关
  - **contract**: 合同相关
  - **mip**: 流程相关


## 二、接口定义规范(I{EntityName}CSV.java)

### 2.1 文件位置

```
{businessCenter}/src/main/java/com/cmi/{domain}/csf/interfaces/I{EntityName}CSV.java
```

### 2.2 代码模板

```java
package com.cmi.{domain}.csf.interfaces;

import java.util.Map;
import com.cmi.common.domain.PageResult;
import com.cmi.common.domain.Response;
import com.cmi.mks.domain.{module}.{EntityName}VO;
import com.cmi.mks.domain.{module}.{EntityName}Request;

/**
 * {业务描述}CSV接口
 * @author {author}
 * @date {date}
 */
public interface I{EntityName}CSV {

    /**
     * @Function: com.asiainfo.order.center.{module}.interfaces.I{EntityName}CSV:query{EntityName}
     * @Description 查询{业务描述}
     * @ServiceName 查询{业务描述}
     * @Reason 查询{业务描述}
     * @BusiType {业务类型，如：GRYW}
     * @SrvOpType Q
     * @param
     * <table border="1">
     *      <tr><th>key</th><th>type</th><th>描述</th></tr>
     *      <tr><td>{PARAM_NAME}</td><td>{type}</td><td>{参数说明}</td></tr>
     * </table>
     * @return
     * <table border="1">
     *   <tr><th>key</th><th>type</th><th>描述</th></tr>
     *   <tr><td>OUTDATA</td><td>List</td><td>结果集合</td></tr>
     * </table>
     * @throws Exception
     * @version v1.0.0
     * @author {author}
     * @date {date}
     * Modification History:
     *   Date         Author          Version            Description
     *-------------------------------------------------------------
     * {date}         {author}        v1.0.0             {初始创建/功能说明}
     */
    Response<{EntityName}VO> query{EntityName}({EntityName}Request request) throws Exception;
    
    /**
     * @Function: com.asiainfo.order.center.{module}.interfaces.I{EntityName}CSV:query{EntityName}Count
     * @Description 查询{业务描述}计数
     * @ServiceName 查询{业务描述}计数
     * @Reason 查询{业务描述}计数
     * @BusiType {业务类型，如：GRYW}
     * @SrvOpType Q
     * @param
     * <table border="1">
     *      <tr><th>key</th><th>type</th><th>描述</th></tr>
     *      <tr><td>{PARAM_NAME}</td><td>{type}</td><td>{参数说明}</td></tr>
     * </table>
     * @return
     * <table border="1">
     *   <tr><th>key</th><th>type</th><th>描述</th></tr>
     *   <tr><td>COUNT</td><td>int</td><td>总数</td></tr>
     * </table>
     * @throws Exception
     * @version v1.0.0
     * @author {author}
     * @date {date}
     * Modification History:
     *   Date         Author          Version            Description
     *-------------------------------------------------------------
     * {date}         {author}        v1.0.0             {初始创建/功能说明}
     */
    Response<PageResult<{EntityName}VO>> query{EntityName}List({EntityName}Request request) throws Exception;
    
    /**
     * @Function: com.asiainfo.order.center.{module}.interfaces.I{EntityName}CSV:save{EntityName}
     * @Description 保存{业务描述}
     * @ServiceName 保存{业务描述}
     * @Reason 保存{业务描述}
     * @BusiType {业务类型，如：GRYW}
     * @SrvOpType W
     * @param
     * <table border="1">
     *      <tr><th>key</th><th>type</th><th>描述</th></tr>
     *      <tr><td>{PARAM_NAME}</td><td>{type}</td><td>{参数说明}</td></tr>
     * </table>
     * @throws Exception
     * @version v1.0.0
     * @author {author}
     * @date {date}
     * Modification History:
     *   Date         Author          Version            Description
     *-------------------------------------------------------------
     * {date}         {author}        v1.0.0             {初始创建/功能说明}
     */
    Response save{EntityName}({EntityName}Request request) throws Exception;
    
    /**
     * @Function: com.asiainfo.order.center.{module}.interfaces.I{EntityName}CSV:save{EntityName}Batch
     * @Description 批量保存{业务描述}
     * @ServiceName 批量保存{业务描述}
     * @Reason 批量保存{业务描述}
     * @BusiType {业务类型，如：GRYW}
     * @SrvOpType W
     * @param
     * <table border="1">
     *      <tr><th>key</th><th>type</th><th>描述</th></tr>
     *      <tr><td>{PARAM_NAME}</td><td>{type}</td><td>{参数说明}</td></tr>
     * </table>
     * @throws Exception
     * @version v1.0.0
     * @author {author}
     * @date {date}
     * Modification History:
     *   Date         Author          Version            Description
     *-------------------------------------------------------------
     * {date}         {author}        v1.0.0             {初始创建/功能说明}
     */
    Response save{EntityName}Batch({EntityName}Request request) throws Exception;
    
    
    
    /**
     * @Function: com.asiainfo.order.center.{module}.interfaces.I{EntityName}CSV:delete{EntityName}
     * @Description 删除{业务描述}
     * @ServiceName 删除{业务描述}
     * @Reason 删除{业务描述}
     * @BusiType {业务类型，如：GRYW}
     * @SrvOpType W
     * @param
     * <table border="1">
     *      <tr><th>key</th><th>type</th><th>描述</th></tr>
     *      <tr><td>{PARAM_NAME}</td><td>{type}</td><td>{参数说明}</td></tr>
     * </table>
     * @throws Exception
     * @version v1.0.0
     * @author {author}
     * @date {date}
     * Modification History:
     *   Date         Author          Version            Description
     *-------------------------------------------------------------
     * {date}         {author}        v1.0.0             {初始创建/功能说明}
     */
    Response delete{EntityName}({EntityName}Request request) throws Exception;
    
}
```

### 2.3 JavaDoc注释说明

- `@Description`：服务描述（中文） 填写服务描述，空格或tab后，增加描述内容，不要有分号，冒号，逗号等
- `@ServiceName`：服务名称（中文）要求大于10个中文
- `@Reason`：需求新增原因（中文）
- `@BusiType`：业务类别（KDYW--宽带业务;ZGYW--账管业务;GRYW--个人业务;JTYW--集团业务）
- `@SrvOpType`：服务类型（Q--查询类；C--校验类；W--操作类型）
- `@param`：入参说明，使用表格格式描述 key、type、描述
- `@return`：出参说明，使用表格格式描述 key、type、描述
- `@author`：开发人员 git账号
- `@date`：创建日期

## 三、实现类规范({EntityName}CSVImpl.java)

### 3.1 文件位置

```
{businessCenter}/src/mian/java/com/cmi/{domain}/csf/impl/{EntityName}CSVImpl.java
```

### 3.2 代码模板

```java
package com.cmi.{domain}.csf.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import java.util.Map;
import com.cmi.common.domain.PageResult;
import com.cmi.common.domain.Response;
import com.cmi.mks.domain.{module}.{EntityName}VO;
import com.cmi.mks.domain.{module}.{EntityName}Request;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.cmi.common.util.CmiExptUtil;
import com.alibaba.fastjson.JSON;

import com.cmi.mks.business.{module}.impl.{EntityName}BizSVImpl;
import com.cmi.mks.business.{module}.interfaces.I{EntityName}BizSV;
/**
 * {业务描述}CSV实现类
 * @author {author}
 * @date {date}
 */
public class {EntityName}CSVImpl implements I{EntityName}CSV {

    /**
     * 查询{实体描述}
     */
    @Override 
    Response<{EntityName}VO> query{EntityName}({EntityName}Request request) throws Exception Response<{EntityName}VO> query{EntityName}({EntityName}Request request) throws Exception {
        logger.info(">>>>>>>>>>>>>query{EntityName}>>>>>>>>>>>>");

        //判断参数是否为空
        if (request == null) {
            CmiExptUtil.throwBusinessException(null, MksExceptionConstants.RESULT_CODE_20001, null);
        }
        Response response = new Response();
        try {
            logger.info("query{EntityName}----request="+ JSON.toJSONString(request));
            I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
            response = mksBizSVImpl.query{EntityName}(request);
            logger.info("query{EntityName}----response="+ JSON.toJSONString(response));
        }catch (Exception ex){
            logger.error("query{EntityName} except cause={}"+ex);
            throw ex;
        }
        return response;
    }
    
    /**
     * 查询{实体描述}列表
     */
    @Override
    Response<PageResult<{EntityName}VO>> query{EntityName}List({EntityName}Request request) throws Exception{
        //判断参数是否为空
        if (request == null) {
             CmiExptUtil.throwBusinessException(null, MksExceptionConstants.RESULT_CODE_20001, null);
        }
        try {
            logger.info("query{EntityName}List----request="+ JSON.toJSONString(request));
            I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
            response = mksTaskBizSVImpl.query{EntityName}List(request);
            logger.info("query{EntityName}List----response="+ JSON.toJSONString(response));
        }catch (Exception ex){
            logger.error("query{EntityName}List except cause={}"+ex);
            throw ex;
        }
        return response;
    }
    
    /**
     * 保存{实体描述}
     */
    @Override
    Response save{EntityName}({EntityName}Request request) throws Exception {
        Response response = new Response();
        try{
            if(logger.isInfoEnabled()){
                logger.info("save{EntityName}----request="+ JSON.toJSONString(request));
            }
            I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
            response = mksBizSVImpl.save{EntityName}(request);
            if(logger.isInfoEnabled()) {
                logger.info("save{EntityName}----response=" + JSON.toJSONString(response));
            }
            response.setSuccess(true);
            response.setResultCode(ExceptCodeConstants.Busi.SUCCESS);
            response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
        }catch (Exception ex){
            if(logger.isErrorEnabled()){
                logger.error("save{EntityName} except :{}"+ex);
            }
            throw ex;
        }

        return response;
    }
    
    /**
     * 批量保存{实体描述}
     */
    @Override
    public void save{EntityName}Batch(Map input) throws Exception {
        Response response = new Response();
        try{
            if(logger.isInfoEnabled()){
                logger.info("save{EntityName}Batch----request="+ JSON.toJSONString(request));
            }
            I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
            response = mksTaskBizSVImpl.save{EntityName}Batch(request);
            if(logger.isInfoEnabled()) {
                logger.info("addTask----response=" + JSON.toJSONString(response));
            }
            response.setSuccess(true);
            response.setResultCode(ExceptCodeConstants.Busi.SUCCESS);
            response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
        }catch (Exception ex){
            if(logger.isErrorEnabled()){
                logger.error("except :{}"+ex);
            }
            throw ex;
        }

        return response;
    }
    
    /**
     * 删除{实体描述}
     */
    @Override
    public void delete{EntityName}(Map input) throws Exception {
        Response response = new Response();
        try{
            if(logger.isInfoEnabled()){
                logger.info("delete{EntityName}----request="+ JSON.toJSONString(request));
            }
            I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
            response = mksBizSVImpl.delete{EntityName}(request);
            if(logger.isInfoEnabled()) {
                logger.info("delete{EntityName}----response=" + JSON.toJSONString(response));
            }
            response.setSuccess(true);
            response.setResultCode(ExceptCodeConstants.Busi.SUCCESS);
            response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
        }catch (Exception ex){
            if(logger.isErrorEnabled()){
                logger.error("delete{EntityName} except :{}"+ex);
            }
            throw ex;
        }
        return response;
    }
}
```

### 3.3 关键要点

#### 3.3.1 包名规范
- 固定包名结构：`com.cmi.{domain}.business.{module}`
- **不使用**版本号(如center2)

#### 3.3.2 导入类规范
```java
// AppFrame核心类
import com.ai.appframe2.bo.DataContainer;
import com.ai.appframe2.service.ServiceFactory;

// 业务框架工具类
import com.asiainfo.busiframe.exception.BusiExceptionUtils;
import com.asiainfo.busiframe.shoppingcart.utils.CheckUtil;
import com.asiainfo.busiframe.util.PartTool;

// Apache工具类
import org.apache.commons.collections.MapUtils;

// Java基础类
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
```

#### 3.3.3 参数校验

```java
// 1. 校验Map不为空
if (MapUtils.isEmpty(input)) {
    BusiExceptionUtils.throwException(Common.COMMON_100103);
}

// 2. 校验必填参数
CheckUtil.checkParam(input, "PARAM_NAME");

// 3. 校验多个必填参数，多个参数拼接为一个字符串作为入参的一部分
CheckUtil.checkParam(input, "PARAM1, PARAM2, PARAM3");
```
**重要**   CheckUtil.checkParam校验多个必填参数，多个参数拼接为一个字符串作为入参的一部分

正确样例：
```java
   CheckUtil.checkParam(input, "PARAM1, PARAM2, PARAM3");
```
错误样例：
```java

CheckUtil.checkParam(input, "PARAM1","PARAM2", "PARAM3");
```

#### 3.3.4 服务调用
```java
// 通过ServiceFactory获取SV层服务
I{EntityName}SV sv = (I{EntityName}SV) ServiceFactory.getService(I{EntityName}SV.class);

// 调用服务方法
DataContainer[] dcs = sv.query{EntityName}(input);
```

#### 3.3.5 结果转换
```java
// bean复制到vo 使用 BeanUtil.copyProperties
MksBatchHandleInfoVo vo = new MksBatchHandleInfoVo();
        BeanUtil.copyProperties(vo,bean);

```

## 四、标准方法实现模式

### 4.1 查询方法(Query)

```java
@Override
  Response<{EntityName}VO> query{EntityName}({EntityName}Request request) throws Exception Response<{EntityName}VO> query{EntityName}({EntityName}Request request) throws Exception {
    logger.info(">>>>>>>>>>>>>query{EntityName}>>>>>>>>>>>>");

    //判断参数是否为空
    if (request == null) {
        CmiExptUtil.throwBusinessException(null, MksExceptionConstants.RESULT_CODE_20001, null);
    }
    Response response = new Response();
    try {
        logger.info("query{EntityName}----request="+ JSON.toJSONString(request));
        I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
        response = mksBizSVImpl.query{EntityName}(request);
        logger.info("query{EntityName}----response="+ JSON.toJSONString(response));
    }catch (Exception ex){
        logger.error("query{EntityName} except cause={}"+ex);
        throw ex;
    }
        return response;
    }

```

### 4.2 查询列表

```java
@Override
Response<PageResult<{EntityName}VO>> query{EntityName}List({EntityName}Request request) throws Exception{
    //判断参数是否为空
    if (request == null) {
        CmiExptUtil.throwBusinessException(null, MksExceptionConstants.RESULT_CODE_20001, null);
    }
    try {
        logger.info("query{EntityName}List----request="+ JSON.toJSONString(request));
        IMksTaskBizSV mksTaskBizSVImpl = (IMksTaskBizSV) ServiceFactory.getService(IMksTaskBizSV.class);
        response = mksTaskBizSVImpl.query{EntityName}List(request);
        logger.info("query{EntityName}List----response="+ JSON.toJSONString(response));
    }catch (Exception ex){
        logger.error("query{EntityName}List except cause={}"+ex);
        throw ex;
    }
    return response;

```

### 4.3 新增方法(Add/Save)

```java
@Override
Response save{EntityName}({EntityName}Request request) throws Exception {
 Response response = new Response();
 try{
     if(logger.isInfoEnabled()){
        logger.info("save{EntityName}----request="+ JSON.toJSONString(request));
     }
     I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
    response = mksBizSVImpl.save{EntityName}(request);
    if(logger.isInfoEnabled()) {
        logger.info("save{EntityName}----response=" + JSON.toJSONString(response));
    }
    response.setSuccess(true);
    response.setResultCode(ExceptCodeConstants.Busi.SUCCESS);
    response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
}catch (Exception ex){
     if(logger.isErrorEnabled()){
        logger.error("save{EntityName} except :{}"+ex);
    }
    throw ex;
}

return response;

}
```

### 4.4 批量新增方法(SaveBatch)

```java
@Override
public void save{EntityName}Batch(Map input) throws Exception {
    Response response = new Response();
    try{
        if(logger.isInfoEnabled()){
            logger.info("save{EntityName}Batch----request="+ JSON.toJSONString(request));
        }
        I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
        response = mksTaskBizSVImpl.save{EntityName}Batch(request);
        if(logger.isInfoEnabled()) {
            logger.info("addTask----response=" + JSON.toJSONString(response));
        }
        response.setSuccess(true);
        response.setResultCode(ExceptCodeConstants.Busi.SUCCESS);
        response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
    }catch (Exception ex){
        if(logger.isErrorEnabled()){
            logger.error("except :{}"+ex);
        }
        throw ex;
    }

    return response;
    }

}
```



### 4.6 删除方法(Delete)

```java
@Override
public void delete{EntityName}(Map input) throws Exception {
    Response response = new Response();
    try{
        if(logger.isInfoEnabled()){
            logger.info("delete{EntityName}----request="+ JSON.toJSONString(request));
        }
        I{EntityName}BizSV mksBizSVImpl = (I{EntityName}BizSV) ServiceFactory.getService(I{EntityName}BizSV.class);
        response = mksBizSVImpl.delete{EntityName}(request);
        if(logger.isInfoEnabled()) {
         logger.info("delete{EntityName}----response=" + JSON.toJSONString(response));
        }
        response.setSuccess(true);
        response.setResultCode(ExceptCodeConstants.Busi.SUCCESS);
        response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
    }catch (Exception ex){
        if(logger.isErrorEnabled()){
        logger.error("delete{EntityName} except :{}"+ex);
        }
        throw ex;
    }
    return response;
}

```

## 五、实际案例

### 5.1 绑定记录CSV

#### 接口定义
```java

package com.cmi.mks.csf.interfaces;

import com.cmi.common.domain.PageResult;
import com.cmi.common.domain.Response;
import com.cmi.mks.domain.binding.BindInfoResultVo;
import com.cmi.mks.domain.binding.BindingHandleRequest;
import com.cmi.mks.domain.binding.BindingMainHandleListQueryVo;
import com.cmi.mks.domain.binding.BindingPageQueryRequest;
import com.cmi.mks.domain.binding.BindingPageQueryVo;
import com.cmi.mks.domain.binding.BindingSubsHandleQueryRequest;
import com.cmi.mks.domain.binding.BindingSubsHandleQueryVo;
import com.cmi.mks.domain.binding.CheckBindHandleRequest;
import com.cmi.mks.domain.binding.CheckBindHandleVo;
import com.cmi.mks.domain.binding.MainHandleCurrencyVo;
import com.cmi.mks.domain.binding.UntryingRequest;

/**
 * @Author:cxq
 * @Date:2019/2/27
 */
public interface IBindingCSV {

    /**
     * 绑定管理查询页面
     * @param request
     * @return
     * @throws Exception
     */
    Response<PageResult<BindingPageQueryVo>> getBindingListPage(BindingPageQueryRequest request) throws Exception;

    /**
     * 捆绑主单查询
     * @param request
     * @return
     * @throws Exception
     */
    Response<PageResult<BindingMainHandleListQueryVo>> getBindingMainHandleListPage(BindingPageQueryRequest request) throws Exception;

    /**
     * 捆绑子单查询接口
     */
    Response<PageResult<BindingSubsHandleQueryVo>> getBindingSubsHandleListPage(BindingSubsHandleQueryRequest request) throws Exception;

    /**
     * 捆绑单详情查询
     */
    Response<BindInfoResultVo> queryBindingInfoByBindCode(BindingPageQueryRequest request) throws Exception;

    /**
     * 捆绑操作
     */
    Response bindingHandle(BindingHandleRequest request) throws Exception;

    /**
     * 解绑操作
     */
    Response unTryingHandle(UntryingRequest request) throws Exception;


    /**
     * 信息变更与退租，校验受理单是否在捆版单中
     * @param request
     * @return
     * @throws Exception
     */
    public Response checkHandleBind(BindingPageQueryRequest request) throws Exception ;
    /**
     * 查询主单的货币
     * @param request
     * @return
     * @throws Exception
     */
    Response<MainHandleCurrencyVo> queryMainHandleCurrency(BindingHandleRequest request)throws  Exception;

    Response updateBindInfoInLease(BindingPageQueryRequest request) throws Exception  ;

    public Response checkHandleBindBySubsIds(BindingHandleRequest request) throws Exception ;

    /**
     * 检查当前subsId是否存在有效捆绑单且为主单还是子单，捆绑单号多少
     */
    public Response<CheckBindHandleVo> checkIsBindHandle(CheckBindHandleRequest request) throws Exception;
}

```

#### 实现类
```java
package com.cmi.mks.csf.impl;

import com.cmi.common.ServiceContext;
import com.cmi.common.constants.ExceptCodeConstants;
import com.cmi.common.domain.PageResult;
import com.cmi.common.domain.Response;
import com.cmi.common.util.CmiExptUtil;
import com.cmi.mks.business.binding.interfaces.IBindingBusiSV;
import com.cmi.mks.constants.MksExceptionConstants;
import com.cmi.mks.csf.interfaces.IBindingCSV;
import com.cmi.mks.domain.binding.*;
import org.apache.commons.lang.math.NumberUtils;

import java.util.ArrayList;
import java.util.List;

/**
 * @Author:cxq
 * @Date:2019/2/27
 */
public class BindingCSVImpl implements IBindingCSV {
    /**
     * 绑定管理查询页面
     * @param request
     * @return
     * @throws Exception
     */
    @Override
    public Response<PageResult<BindingPageQueryVo>> getBindingListPage(BindingPageQueryRequest request) throws Exception {
        Response<PageResult<BindingPageQueryVo>> response = new Response<>();
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        PageResult<BindingPageQueryVo> listPage = iBindingBusiSV.getBindingListPage(request);
        response.setSuccess(true);
        response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
        response.setResult(listPage);
        return response;
    }

    /**
     * 捆绑主单查询
     * @param request
     * @return
     * @throws Exception
     */
    @Override
    public Response<PageResult<BindingMainHandleListQueryVo>> getBindingMainHandleListPage(BindingPageQueryRequest request) throws Exception {
        Response<PageResult<BindingMainHandleListQueryVo>> response = new Response<>();
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        PageResult<BindingMainHandleListQueryVo> listPage = iBindingBusiSV.getBindingMainHandleListPage(request);
        response.setSuccess(true);
        response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
        response.setResult(listPage);
        return response;
    }

    /**
     * IPT子单查询接口
     * @param request
     * @return
     * @throws Exception
     */
    @Override
    public Response<PageResult<BindingSubsHandleQueryVo>> getBindingSubsHandleListPage(BindingSubsHandleQueryRequest request) throws Exception {
        Response<PageResult<BindingSubsHandleQueryVo>> response = new Response<>();
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        PageResult<BindingSubsHandleQueryVo> listPage = iBindingBusiSV.getBindingSubsHandleListPage(request);
        response.setSuccess(true);
        response.setResultMessage(ExceptCodeConstants.Busi.SUCCESS_MESSAGE);
        response.setResult(listPage);
        return response;
    }

    /**
     * 捆绑单详情查询
     * @param request
     * @return
     * @throws Exception
     */
    @Override
    public Response<BindInfoResultVo> queryBindingInfoByBindCode(BindingPageQueryRequest request) throws Exception {
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        Response<BindInfoResultVo> response = iBindingBusiSV.queryBindingInfoByBindCode(request);
        return response;
    }

    /**
     * 组合单捆绑
     * @param request
     * @return
     * @throws Exception
     */
    @Override
    public Response bindingHandle(BindingHandleRequest request) throws Exception {
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        Response response = iBindingBusiSV.bindingHandle(request);
        return response;
    }

    /**
     * 解绑操作
     * @param request
     * @return
     * @throws Exception
     */
    @Override
    public Response unTryingHandle(UntryingRequest request) throws Exception {
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        Response response = iBindingBusiSV.unTryingHandle(request);
        return response;
    }

    /**
     * 查询主单的货币
     * @param request
     * @return
     * @throws Exception
     */
    @Override
    public Response<MainHandleCurrencyVo> queryMainHandleCurrency(BindingHandleRequest request) throws Exception {
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        Response<MainHandleCurrencyVo> response = iBindingBusiSV.queryMainHandleCurrency(request);
        return response;
    }

    /**
     * 信息变更与退租，校验受理单是否在捆版单中
     * @param request
     * @return
     * @throws Exception
     */
    @Override
    public Response checkHandleBind(BindingPageQueryRequest request) throws Exception {
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        if (request == null ) {
            CmiExptUtil.throwBusinessException(MksExceptionConstants.Special.PARAM_IS_NULL);
        }
        String language = request.getLocale().getLanguage();
        Long handleId = NumberUtils.toLong(request.getBindingCode());
        String changeName = request.getFromType();
        Response response = iBindingBusiSV.checkHandleBind(language, handleId, changeName);
        return response;
    }

    @Override
    public Response updateBindInfoInLease(BindingPageQueryRequest request) throws Exception {
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        if (request == null ) {
            CmiExptUtil.throwBusinessException(MksExceptionConstants.Special.PARAM_IS_NULL);
        }
        String prodOrdId = request.getProdOrdId();
        Long newHandleId = NumberUtils.toLong(request.getBindingCode());
        Long newSubsId = NumberUtils.toLong(request.getServNbr());
        Response response = iBindingBusiSV.updateBindInfoInLease(prodOrdId, newHandleId, newSubsId);
        return response;
    }

    @Override
    public Response checkHandleBindBySubsIds(BindingHandleRequest request) throws Exception {
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        if (request == null ) {
            CmiExptUtil.throwBusinessException(MksExceptionConstants.Special.PARAM_IS_NULL);
        }
        List<Long> subsId =  new ArrayList<>();
        String language = request.getLocale().getLanguage();
        List<BindingSubsHandleInfoVo> bindingSubsHandleInfoVos = request.getSubHandleInfoList();
        for (BindingSubsHandleInfoVo bindingSubsHandleInfoVo: bindingSubsHandleInfoVos) {
            subsId.add(bindingSubsHandleInfoVo.getSubSubsId());
        }
        Response response = iBindingBusiSV.checkHandleBindBySubsIds(language, subsId);
        return response;
    }

    /**
     * 检查当前subsId是否存在有效捆绑单且为主单还是子单，捆绑单号多少
     * @param request
     * @return
     */
    @Override
    public Response<CheckBindHandleVo> checkIsBindHandle(CheckBindHandleRequest request) throws Exception {
        IBindingBusiSV iBindingBusiSV = ServiceContext.getService(IBindingBusiSV.class);
        if (request == null ) {
            CmiExptUtil.throwBusinessException(MksExceptionConstants.Special.PARAM_IS_NULL);
        }
        Response response = iBindingBusiSV.checkIsBindHandle(request);
        return response;
    }
}

```

## 六、命名规范

### 6.1 类命名
- 接口：`I{EntityName}CSV`
- 实现类：`{EntityName}CSVImpl`

### 6.2 方法命名
- 查询：`query{EntityName}` / `get{EntityName}` / `find{EntityName}`
- 查询计数：`query{EntityName}Count`
- 新增：`save{EntityName}` / `add{EntityName}` / `insert{EntityName}`
- 批量新增：`save{EntityName}Batch` / `batch{EntityName}`
- 修改：`update{EntityName}` / `modify{EntityName}`
- 删除：`delete{EntityName}` / `remove{EntityName}`

### 6.3 常用方法后缀
- 查询单个：`query{EntityName}ById`
- 查询列表：`query{EntityName}List`
- 分页查询：`query{EntityName}Page`

## 七、必须遵守的规则

1. **固定包名**：必须使用`com.cmi.{domain}`格式，不使用版本号
2. **参数校验**：所有方法必须进行参数校验
3. **异常处理**：使用`BusiExceptionUtils`抛出业务异常
4. **服务获取**：使用`ServiceFactory.getService()`获取SV层服务
5. **结果转换**：使用`PartTool.toList()`转换DataContainer数组
6. **注释完整**：接口方法必须包含完整的JavaDoc注释，包括参数和返回值表格
7. **代码简洁**：CSV层只负责参数校验和服务调用，不包含业务逻辑
8. **代码一致**：同一模块的CSV实现保持代码风格一致



## 九、代码生成流程

### 9.1 生成步骤
1. **解析表结构**：从SQL或数据字典获取表结构信息
2. **确定位置**：根据业务域和表名确定代码生成位置
2. **生成BO文件**：定义数据库和java对象映射关系文件
3. **生成IValues接口**：定义数据接口
4. **生成Bean类**：生成BO层的Bean类
5. **生成Engine类**：生成BO层的Engine类
6. **生成DAO接口**：定义数据访问接口
7. **生成DAO实现**：实现数据访问逻辑
8. **生成Service接口**：定义服务接口
9. **生成Service实现**：实现服务逻辑
10. **生成CSV接口**：定义服务接口
11. **生成CSV实现**：实现服务逻辑
12. **代码检查**：检查实现类是否已经实现对应的接口，如未实现，请更新代码，实现相关接口



## 十、版本历史

| 版本 | 日期         | 作者           | 说明 |
|-----|------------|--------------|------|
| v1.0.0 | 2026/03/10 | songcq       | 初始版本，基于ordercenter实际代码总结 |

