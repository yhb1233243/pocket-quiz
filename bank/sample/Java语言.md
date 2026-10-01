# Java语言

# 1. == 和 equals 的区别

`==` 比较的是变量（栈）中存储的值：对基本类型是数值本身，对引用类型是内存地址。
`equals` 是方法，默认实现（`Object.equals`）等价于 `==`；`String`、`Integer` 等类重写了它，改为比较内容。

```java
String a = new String("hi");
String b = new String("hi");
a == b;      // false，两个对象地址不同
a.equals(b); // true，内容相同
```

###### 背会

== 比地址，equals 默认比地址、重写后比内容。

# 2. final、finally、finalize 有什么区别

- `final`：修饰符。修饰类不可继承，修饰方法不可重写，修饰变量不可重新赋值。
- `finally`：异常处理块，无论是否发生异常都会执行，常用于释放资源。
- `finalize`：`Object` 的方法，GC 回收对象前调用，Java 9 起已废弃，不要使用。

###### 背会

final 是修饰符，finally 是必执行块，finalize 是废弃的回收钩子。

# 3. 重载和重写的区别

- 重载（Overload）：同类中方法名相同、参数列表不同，与返回值无关，编译期决定。
- 重写（Override）：子类重新实现父类方法，签名相同，访问权限不能更严，抛出异常不能更宽，运行期按实际类型分派。

###### 背会

重载看参数、编译期；重写看继承、运行期。
