# LangChain

# 1. LangChain&Agents

### Tools

```text
先简单说一下tools:tools是代理、链或LLM可用于与世界交互的接口

在构建自己的代理时，您需要向它提供可以使用的工具列表
组成:name description args_schema
下面仅提供最简单的示例
```

```python
# 实例
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper

api_wrapper = WikipediaAPIWrapper(top_k_results=1, doc_content_chars_max=100)
tool = WikipediaQueryRun(api_wrapper=api_wrapper)

tool.name
tool.description
tool.args  # {'query': {'title': 'Query', 'type': 'string'}}
tool.return_direct  # 该工具是否应该直接返回给用户
tool.run({"query": "langchain"})
tool.run("langchain")
```

定义一个tools

```python
# Import things that are needed generically
from langchain.pydantic_v1 import BaseModel, Field
from langchain.tools import BaseTool, StructuredTool, tool

@tool
def search(query: str) -> str:
    """Look up things online."""
    return "LangChain"

print(search.name)
print(search.description)
print(search.args)
```

```text
# 输出
search
search(query: str) -> str - Look up things online.
{'query': {'title': 'Query', 'type': 'string'}}
```

另外一种tools定义
```python
from langchain.tools.retriever import create_retriever_tool

retriever_tool = create_retriever_tool(
    retriever,
    "langsmith_search",
    "Search for information about LangSmith. For any questions about LangSmith, you must use this tool!",
)
```
### What's Agents

```text
主要包括:资源点==>retriever,大模型==>llm,工具(检索+其他)==>tools,提示词==>prompt,agent创建器

由于agents里面很多:self-determined, input-dependent sequence of steps 特性
所以需要LangSmith进行自动跟踪

export LANGCHAIN_TRACING_V2="true"
export LANGCHAIN_API_KEY="<your-api-key>"
export TAVILY_API_KEY="..."
```

```python
# 示例
# Initialize a toolkit
toolkit = ExampleTookit(...)
# Get list of tools
tools = toolkit.get_tools()
# Create agent
agent = create_agent_method(llm, tools, prompt)
```

Tools 示例

```python
# search 在线搜索
from langchain_community.tools.tavily_search import TavilySearchResults

search = TavilySearchResults()
search.invoke("what is the weather in SF")

# Retriever
from langchain_community.document_loaders import WebBaseLoader
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

loader = WebBaseLoader("https://docs.smith.langchain.com/overview")
docs = loader.load()
documents = RecursiveCharacterTextSplitter(
    chunk_size=1000, chunk_overlap=200
).split_documents(docs)
vector = FAISS.from_documents(documents, OpenAIEmbeddings())
retriever = vector.as_retriever()

# tools
from langchain.tools.retriever import create_retriever_tool
retriever_tool = create_retriever_tool(
    retriever,
    "langsmith_search",
    "Search for information about LangSmith. For any questions about LangSmith, you must use this tool!",
)
tools = [search, retriever_tool]
```
开始创建Agents
```python
from langchain_openai import ChatOpenAI
from langchain import hub
from langchain.agents import create_openai_functions_agent
from langchain.agents import AgentExecutor

# 准备一些必备的stuff
llm = ChatOpenAI(model="gpt-3.5-turbo", temperature=0)
prompt = hub.pull("hwchase17/openai-functions-agent")
agent = create_openai_functions_agent(llm, tools, prompt)
agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# 开始执行
agent_executor.invoke({"input": "hi!"})
agent_executor.invoke({"input": "how can langsmith help with testing?"})

# 添加历史
from langchain_core.messages import AIMessage, HumanMessage

agent_executor.invoke({"input": "hi! my name is bob", "chat_history": []})
agent_executor.invoke(
    {
        "chat_history": [
            HumanMessage(content="hi! my name is bob"),
            AIMessage(content="Hello Bob! How can I assist you today?"),
        ],
        "input": "what's my name?",
    }
)
```
```text
prompt内容:
[SystemMessagePromptTemplate(prompt=PromptTemplate(input_variables=[], template='You are a helpful assistant')),
 MessagesPlaceholder(variable_name='chat_history', optional=True),
 HumanMessagePromptTemplate(prompt=PromptTemplate(input_variables=['input'], template='{input}')),
 MessagesPlaceholder(variable_name='agent_scratchpad')]
```

### Reference(参考文档)

* [LangChain-Agents](https://python.langchain.com/docs/modules/agents/)
* [LangChain-tools](https://python.langchain.com/docs/modules/tools/custom_tools/)

# 2. LangChain&CSV

### 基于存储在 CSV 文件中的数据构建 Q&A 系统
与使用 SQL数据库一样,使用 CSV文件的关键是提供对用于查询数据和与数据交互的工具LLM的访问权限
```text
1.将 CSV 加载到 SQL 数据库中，并使用 SQL 例子文档中写的方法
2.提供对 Python 环境LLM的访问权限，在该环境中，它可以使用 Pandas 等库与数据进行交互。
```
- 使用SQL与CSV数据进行交互，因为与任意Python相比，限制权限和清理查询更容易
```python
from langchain_community.utilities import SQLDatabase
from sqlalchemy import create_engine
import pandas as pd

df = pd.read_csv("titanic.csv")
engine = create_engine("sqlite:///titanic.db")
# 将 CSV 文件作为 SQLite 表加载
df.to_sql("titanic", engine, index=False)
```
- 创建一个 SQL 代理来与之交互
```python
from langchain_community.agent_toolkits import create_sql_agent
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-3.5-turbo", temperature=0)
agent_executor = create_sql_agent(llm, db=db, agent_type="openai-tools", verbose=True)
agent_executor.invoke({"input": "what's the average age of survivors"})
```

[demo03.ipynb](LangChain%2Fdemo03.ipynb)

### Reference(参考文档)

* [LangChain-CSV](https://python.langchain.com/docs/use_cases/sql/quickstart)

# 3. LangChain&LCEL

### Concept
LangChain Expression Language
### How
1. 普通chain

chain = prompt | model | output parser
```python
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

prompt = ChatPromptTemplate.from_template("tell me a short joke about {topic}")
model = ChatOpenAI(model="gpt-4")
output_parser = StrOutputParser()

chain = prompt | model | output_parser

chain.invoke({"topic": "ice cream"})
```
2. RAG 检索增强生成链

chain = setup_and_retrieval | prompt | model | output_parser
```python
# Requires:
# pip install langchain docarray tiktoken

from langchain_community.vectorstores import DocArrayInMemorySearch
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableParallel, RunnablePassthrough
from langchain_openai.chat_models import ChatOpenAI
from langchain_openai.embeddings import OpenAIEmbeddings

vectorstore = DocArrayInMemorySearch.from_texts(
    ["harrison worked at kensho", "bears like to eat honey"],
    embedding=OpenAIEmbeddings(),
)
retriever = vectorstore.as_retriever()

template = """Answer the question based only on the following context:
{context}

Question: {question}
"""
prompt = ChatPromptTemplate.from_template(template)
model = ChatOpenAI()
output_parser = StrOutputParser()

setup_and_retrieval = RunnableParallel(
    {"context": retriever, "question": RunnablePassthrough()}
)
chain = setup_and_retrieval | prompt | model | output_parser

chain.invoke("where did harrison work?")
```

### Reference(参考文档)

* [LCEL](https://python.langchain.com/docs/expression_language/get_started)

# 4. LangChain&Server&Cli

### What it is
LangServe 可以帮助将 LangChain 可运行的可运行程序和链部署为 REST API

### Reference(参考文档)

* [langserve](https://python.langchain.com/docs/langserve)
* [实例](https://github.com/langchain-ai/langchain/blob/master/templates/README.md)

# 5. LangChain&SQL

### 在 SQL 数据库上创建 Q&A chain和 Agent 的基本方法
概括地说，任何 SQL 链和代理的步骤都是：
```text
1.将问题转换为 SQL 查询：模型将用户输入转换为 SQL 查询。
2.执行SQL查询：执行SQL查询。
3.回答问题：模型使用查询结果响应用户输入
```

- 数据库
```python
from langchain_community.utilities import SQLDatabase

db = SQLDatabase.from_uri("sqlite:///Chinook.db")
print(db.dialect)
print(db.get_usable_table_names())
print(db.run("SELECT * FROM Artist LIMIT 10;"))
```
- Chain
```python
from langchain.chains import create_sql_query_chain
from langchain_openai import ChatOpenAI
# 测试以确保有效
llm = ChatOpenAI(model="gpt-3.5-turbo", temperature=0)
chain = create_sql_query_chain(llm, db)
response = chain.invoke({"question": "How many employees are there"})
print(response)
```
```python
from langchain_community.tools.sql_database.tool import QuerySQLDataBaseTool
# 使用 QuerySQLDatabaseTool 将查询执行添加到我们的链中
execute_query = QuerySQLDataBaseTool(db=db)
write_query = create_sql_query_chain(llm, db)
chain = write_query | execute_query
chain.invoke({"question": "How many employees are there"})
```
```python
# 将自动生成和执行查询的方法，将问题和结果传递给LLM
from operator import itemgetter

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnablePassthrough

answer_prompt = PromptTemplate.from_template(
    """Given the following user question, corresponding SQL query, and SQL result, answer the user question.

Question: {question}
SQL Query: {query}
SQL Result: {result}
Answer: """
)

answer = answer_prompt | llm | StrOutputParser()
chain = (
    RunnablePassthrough.assign(query=write_query).assign(
        result=itemgetter("query") | execute_query
    )
    | answer
)

chain.invoke({"question": "How many employees are there"})
```
- Agent
```python
# 初始化代理
from langchain_community.agent_toolkits import create_sql_agent

agent_executor = create_sql_agent(llm, db=db, agent_type="openai-tools", verbose=True)
# 执行测试
agent_executor.invoke(
    {
        "input": "List the total sales per country. Which country's customers spent the most?"
    }
)
agent_executor.invoke({"input": "Describe the playlisttrack table"})

```

[demo02.ipynb](LangChain%2Fdemo02.ipynb)

### Reference(参考文档)

* [LangChain-SQL](https://python.langchain.com/docs/use_cases/sql/quickstart)

# 6. LangChain

### LangChain

- Chain
```text
链是指调用序列 - 无论是对 LLM、 工具还是数据预处理步骤。支持的主要方法是使用 LCEL
1.create_retrieval_chain
2.create_sql_query_chain
```

### 典型的 RAG(Retrieval Augmented Generation 检索增强生成) 应用程序包括:

- Indexing(索引)

Load加载：首先我们需要加载数据。为此，我们将使用 DocumentLoaders。

Split拆分：文本拆分器将大 Documents 块分解为更小的块。这对于索引数据和将其传递到模型都很有用，因为大块更难搜索，并且不适合模型的有限上下文窗口。

Store存储：我们需要某个地方来存储和索引我们的拆分，以便以后可以搜索它们。这通常使用 VectorStore 和 Embeddings 模型来完成。

- Retrieval and generation(检索和生成)

Retrieve检索：给定用户输入，使用 Retriever 从存储中检索相关的拆分。

Generate生成：ChatModel / LLM 使用包含问题和检索到的数据的提示生成答案

## Example
[demo01.py](LangChain%2Fdemo01.py)
1. 加载 使用 WebBaseLoader，它用于 urllib 从 Web URL 加载 HTML 并将其 BeautifulSoup 解析为文本
```python
import bs4
from langchain_community.document_loaders import WebBaseLoader

# Only keep post title, headers, and content from the full HTML.
bs4_strainer = bs4.SoupStrainer(class_=("post-title", "post-header", "post-content"))
loader = WebBaseLoader(
    web_paths=("https://lilianweng.github.io/posts/2023-06-23-agent/",),
    bs_kwargs={"parse_only": bs4_strainer},
)
docs = loader.load()
```
2. 拆分 文档长度超过 42k 个字符。这太长了，无法适应许多模型的上下文窗口 我们将文档拆分为 1000 个字符的块，块之间有 200 个字符重叠。重叠有助于减少将语句与与之相关的重要上下文分开的可能性

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000, chunk_overlap=200, add_start_index=True
)
all_splits = text_splitter.split_documents(docs)
```
3. 存储  使用 Chroma 向量存储和 OpenAIEmbeddings 模型在单个命令中嵌入和存储所有文档拆分
```python
from langchain_community.vectorstores import Chroma
from langchain_openai import OpenAIEmbeddings

# Embedding其实是将每个单词或其他类型的标记（如字符、句子或者文档）转换为一个固定长度的向量
vectorstore = Chroma.from_documents(documents=all_splits, embedding=OpenAIEmbeddings())
```
4. 检索
```python
# LangChain 定义了一个 Retriever 接口，该接口包装了一个索引，该索引可以返回给定 Documents 的字符串查询相关。
# "k": 6 表示对于每个查询，检索器应该返回最相似的前6个结果
# retriever 是一个检索器
retriever = vectorstore.as_retriever(search_type="similarity", search_kwargs={"k": 6})
# 执行
retrieved_docs = retriever.invoke("What are the approaches to Task Decomposition?")
```
5. 生成
```python
# 使用一个llm模型
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model_name="gpt-3.5-turbo", temperature=0)
# 使用一个 RAG 的提示，该提示已签入 LangChain 提示中心
from langchain import hub
prompt = hub.pull("rlm/rag-prompt")
```
```python
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)
# 使用 LCEL Runnable 协议来定义链
rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | llm
    | StrOutputParser()
)
for chunk in rag_chain.stream("What is Task Decomposition?"):
    print(chunk, end="", flush=True)
```
[demo01.ipynb](LangChain%2Fdemo01.ipynb)

### Reference(参考文档)

* [LangChain](https://python.langchain.com/docs/use_cases/question_answering/quickstart)

# 7. LC&Extract

### What
基于web平台,使得用户利用LLMs从文本或者文件中提取信息

docker构建且提供api:http://localhost:3000
有需要再研究吧

### Reference(参考文档)
* [langchain-extract](https://github.com/langchain-ai/langchain-extract)
