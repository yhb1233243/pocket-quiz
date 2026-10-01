---
tags:
  - interview
  - 尚硅谷
  - Java
  - Tomcat
source: 尚硅谷Java技术之高频面试题-v2025.1
title: 网络服务器：Tomcat
---

# 网络服务器：Tomcat

> 来源：尚硅谷 Java 技术之高频面试题 v2025.1 · 网络服务器：tomcat

# 1. Tomcat的缺省端口是多少，怎么修改？

默认端口为8080，可以通过在tomcat安装包conf目录下，service.xml中的Connector元素的port属性来修改端口。

# 2. Tomcat 有哪几种Connector 运行模式(优化)？

有三种，这三种模式的不同之处如下：

**BIO**：一个线程处理一个请求。缺点：并发量高时，线程数较多，浪费资源。Tomcat7版本或更低版本中，在Linux系统中默认使用这种方式。

**NIO**：利用Java的异步IO处理，可以通过少量的线程处理大量的请求。Tomcat8.0.x中默认使用的是NIO。Tomcat7必须修改Connector配置来启动。

```XML
<Connector port="8080" protocol="org.apache.coyote.http11.Http11NioProtocol"
connectionTimeout="20000" redirectPort="8443"/>
```

**APR**：即Apache Portable Runtime，从操作系统层面解决io阻塞问题。Tomcat7或Tomcat8在Win7或以上的系统中启动默认使用这种方式。

# 3. Tomcat有几种部署方式？

利用Tomcat的自动部署：把web应用拷贝到webapps目录（生产环境不建议放在该目录中）。

Tomcat在启动时会加载目录下的应用，并将编译后的结果放入work目录下。

使用Manager App控制台部署：在tomcat主页点击“Manager App” 进入应用管理控制台，可以指定一个web应用的路径或war文件。

修改conf/server.xml文件部署：在server.xml文件中，增加Context节点可以部署应用。

增加自定义的Web部署文件：在conf/Catalina/localhost/路径下增加 xyz.xml文件，内容是Context节点，可以部署应用。

# 4. Tomcat容器是如何创建servlet类实例？用到了什么原理？

当容器启动时，会读取在webapps目录下所有的web应用中的web.xml文件，然后对 xml文件进行解析，并读取Servlet注册信息。

然后，将每个应用中注册的servlet类都进行加载，并通过 反射的方式实例化（有时候也是在第一次请求时实例化）。

在Servlet注册时配置load-on-startup如果为正数，则在一开始就实例化，如果不写或为负数，则第一次请求实例化。

# 5. Tomcat如何优化？

Tomcat作为Web服务器，它的处理性能直接关系到用户体验，下面是几种常见的优化措施：

## 5.1. 杂项配置

- 去掉对web.xml的监视，把JSP提前编辑成Servlet。
- 有富余物理内存的情况，加大Tomcat使用的JVM的内存服务器所能提供CPU、内存、硬盘的性能对处理能力有决定性影响。对于高并发情况下会有大量的运算，那么CPU的速度会直接影响到处理速度。内存在大量数据处理的情况下，将会有较大的内存容量需求，可以用-Xmx -Xms -XX:MaxPermSize等参数对内存不同功能块进行划分。我们之前就遇到过内存分配不足，导致虚拟机一直处于full GC，从而导致处理能力严重下降。
- 硬盘主要问题就是读写性能，当大量文件进行读写时，磁盘极容易成为性能瓶颈。最好的办法还是利用下面提到的缓存。利用缓存和压缩对于静态页面最好是能够缓存起来，这样就不必每次从磁盘上读。
- 这里我们采用了Nginx作为缓存服务器，将图片、CSS、JS文件都进行了缓存，有效地减少了后端Tomcat的访问。
- 另外，为了能加快网络传输速度，开启gzip压缩也是必不可少的。但考虑到tomcat已经需要处理很多东西了，所以把这个压缩的工作就交给前端的Nginx来完成。
- 除了文本可以用gzip压缩，其实很多图片也可以用图像处理工具预先进行压缩，找到一个平衡点可以让画质损失很小而文件可以减小很多。曾经我就见过一个图片从300多kb压缩到几十kb，肉眼几乎看不出来区别。
- 采用集群单个服务器性能总是有限的，最好的办法自然是实现横向扩展，那么组建Tomcat集群是有效提升性能的手段。我们还是采用了Nginx来作为请求分流的服务器，后端多个Tomcat共享Session来协同工作。
- 删除没用的Web应用：因为Tomcat启动每次都会部署这些应用。
- 关闭WebSocket：websocket-api.jar和tomcat-websocket.jar。
- 随机数优化：设置JVM参数：-Djava.security.egd=file:/dev/./urandom。

## 5.2. 线程数优化

找到<Connector port="8080" protocol="HTTP/1.1">，增加maxThreads和acceptCount属性（使acceptCount大于等于maxThreads），如下：

```XML
<Connector port="8080" protocol="HTTP/1.1"connectionTimeout="20000" redirectPort="8443"acceptCount="500" maxThreads="400" />
```

其中：

- maxThreads：Tomcat可用于请求处理的最大线程数，默认是200
- minSpareThreads：Tomcat初始线程数，即最小空闲线程数
- maxSpareThreads：Tomcat最大空闲线程数，超过的会被关闭
- acceptCount：当所有可以使用的处理请求的线程数都被使用时，可以放到处理队列中的请求数，超过这个数的请求将不予处理。默认100

## 5.3. 使用线程池优化

在server.xml中增加executor节点，然后配置connector的executor属性，如下：

```XML
<Executor name="tomcatThreadPool" namePrefix="req-exec-"maxThreads="1000"
  minSpareThreads="50"maxIdleTime="60000"/><Connector port="8080" protocol="HTTP/1.1"executor="tomcatThreadPool"/>
```

其中：

- namePrefix：线程池中线程的命名前缀
- maxThreads：线程池的最大线程数
- minSpareThreads：线程池的最小空闲线程数
- maxIdleTime：超过最小空闲线程数时，多的线程会等待这个时间长度，然后关闭
- threadPriority：线程优先级

备注：

当Tomcat并发用户量大的时候，单个JVM进程确实可能打开过多的文件句柄，这时会报java.net.SocketException:Too many open files错误。

可使用下面步骤检查：

- ps -ef |grep tomcat 查看tomcat的进程ID，记录ID号；
- 假设进程ID为10001，则运行： lsof -p 10001|wc -l 查看当前进程id为10001的 文件操作数
- 使用命令：ulimit -a 查看每个用户允许打开的最大文件数启动速度优化

## 5.4. 附：JVM相关参数

-Xms：虚拟机初始化时的最小堆内存。

-Xmx：虚拟机可使用的最大堆内存。

-Xms与-Xmx设成一样的值，避免JVM因为频繁的GC导致性能大起大落

-XX:MaxNewSize：新生代占整个堆内存的最大值。

另外还有方法区参数调整（注意：JDK版本）、垃圾收集器等优化。

# 6. Tomcat的常用配置有哪些？

> 备注：本题的答案内容基于
> Tomcat10

## 6.1. server.xml

标签名

属性名

作用

Server

port

指定Tomcat监听的关闭端口号，默认为8005。

shutdown

指定关闭命令字符串，默认为SHUTDOWN。

Service

name

此服务的显示名称，主要用于在日志中进行标识服务。

Connector

port

指定连接器监听的端口号，对于HTTP协议通常是8080。

protocol

指定使用的协议，如HTTP/1.1或AJP/1.3。

connectionTimeout

客户端连接超时时间（毫秒）。

redirectPort

在需要重定向到SSL时使用的端口号。

Engine

name

引擎的名称，默认主机名为localhost。

defaultHost

默认主机名。

Host

name

虚拟主机的名称。

appBase

Web应用的基本目录。

unpackWARs

如果设置为true，则Tomcat会自动解压WAR文件。

autoDeploy

如果设置为true，则Tomcat会自动部署应用。

Context

docBase

Web应用的文档基础路径。

path

Web应用的上下文路径。

reloadable

如果设置为true，则支持热部署。

Realm

className

指定Realm类的全限定名。

GlobalNamingResources

resourceName

资源名称。

type

资源类型，如javax.sql.DataSource。

description

资源描述。

factory

工厂类名。

pathname

资源路径名。

Valve

className

指定阀门类的全限定名。

AccessLogValve

directory

访问日志目录。

prefix

日志文件前缀。

suffix

日志文件后缀。

pattern

日志格式模式。

Listener

className

指定监听器的类名。

## 6.2. context.xml

标签名

属性名

作用

Context

path

指定Web应用的访问路径。

docBase

Web应用的文件系统路径或WAR文件路径。

reloadable

如果设置为true，Tomcat将在运行时监视Web应用的变化并自动重新加载。

WatchedResource

指定Tomcat应监视的资源文件，如果这些文件发生变化，将触发应用重新加载。

Resource

name

资源的名称，用于JNDI查找。

auth

认证类型，通常为Container。

type

资源的类型，例如javax.sql.DataSource。

driverClassName

JDBC驱动类名。

url

数据库URL。

username

数据库用户名。

password

数据库密码。

maxActive

连接池支持的最大连接数。

maxIdle

连接池中最多可空闲的连接数。

maxWait

连接池中连接用完时，新的请求等待时间（毫秒）。
