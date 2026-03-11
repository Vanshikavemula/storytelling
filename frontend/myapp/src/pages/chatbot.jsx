import {useState} from "react"
import {sendQuery} from "../services/chatbotService"

export default function Chatbot(){

const [messages,setMessages] = useState([])
const [input,setInput] = useState("")

const sendMessage = async()=>{

if(!input.trim()) return

const userMessage = {role:"user",text:input}

setMessages(prev=>[...prev,userMessage])

const res = await sendQuery({
age_group:"child",
genre_or_virtue:input,
story_length:"medium",
other_notes:""
})

const botMessage = {
role:"bot",
text:`${res.generated_story}\n\nMoral: ${res.moral}`
}

setMessages(prev=>[...prev,botMessage])

setInput("")
}

return(

<div className="hero">

<div className="card" style={{padding:"30px",maxWidth:"800px",margin:"auto"}}>

<h2>Story Chatbot</h2>

<div style={{marginTop:"20px"}}>

{messages.map((m,i)=>(
<div key={i} style={{marginBottom:"12px"}}>
<strong>{m.role}:</strong> {m.text}
</div>
))}

</div>

<div style={{display:"flex",gap:"10px",marginTop:"20px"}}>

<input
className="field-input"
placeholder="Ask for a story..."
value={input}
onChange={(e)=>setInput(e.target.value)}
/>

<button
className="primary-btn"
onClick={sendMessage}
>
Send
</button>

</div>

</div>

</div>

)

}