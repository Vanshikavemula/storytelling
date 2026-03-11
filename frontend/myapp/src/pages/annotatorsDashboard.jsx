import { useState, useEffect } from "react";
import "../styles/style.css";

export default function AnnotatorsDashboard() {

const [stories,setStories] = useState([])
const [search,setSearch] = useState("")
const [ageFilter,setAgeFilter] = useState("all")

const [entity,setEntity] = useState("")
const [virtues,setVirtues] = useState("")
const [keywords,setKeywords] = useState("")
const [age,setAge] = useState("")
const [group,setGroup] = useState("")
const [storyText,setStoryText] = useState("")

const [showForm,setShowForm] = useState(false)
const [editingId,setEditingId] = useState(null)

useEffect(()=>{
const saved = localStorage.getItem("stories-data")
if(saved){
setStories(JSON.parse(saved))
}
},[])

useEffect(()=>{
localStorage.setItem("stories-data",JSON.stringify(stories))
},[stories])


function clearForm(){
setEntity("")
setVirtues("")
setKeywords("")
setAge("")
setGroup("")
setStoryText("")
setEditingId(null)
}

function saveStory(){

if(!entity || !storyText){
alert("Entity and Story Text required")
return
}

if(editingId){

setStories(prev =>
prev.map(s =>
s.id === editingId
? {...s,entity,virtues,keywords,age,group,storyText}
: s
))

}else{

setStories(prev =>[
...prev,
{
id:Date.now(),
entity,
virtues,
keywords,
age,
group,
storyText
}
])

}

clearForm()
setShowForm(false)

}

function deleteStory(id){

if(!window.confirm("Delete story?")) return

setStories(prev => prev.filter(s=>s.id !== id))

}

function editStory(story){

setEntity(story.entity)
setVirtues(story.virtues)
setKeywords(story.keywords)
setAge(story.age)
setGroup(story.group)
setStoryText(story.storyText)

setEditingId(story.id)
setShowForm(true)

}

const filteredStories = stories.filter(s => {

const matchAge = ageFilter === "all" || s.age === ageFilter

const combined =
`${s.entity} ${s.virtues} ${s.keywords} ${s.storyText}`.toLowerCase()

const matchSearch = combined.includes(search.toLowerCase())

return matchAge && matchSearch

})


return(

<div className="app-root">

<header className="top-bar">

<div>
<h1 className="app-title">Story Annotators Dashboard</h1>
<p className="app-subtitle">
Welcome Annotator
</p>
</div>

<div className="top-bar-actions">

<button
className="primary-btn"
onClick={()=>setShowForm(!showForm)}
>
Add Story
</button>

</div>

</header>


<div className="toolbar">

<div className="toolbar-left">

<input
className="field-input"
placeholder="Search stories..."
value={search}
onChange={e=>setSearch(e.target.value)}
/>

</div>

<div className="toolbar-right">

<select
className="field-input"
value={ageFilter}
onChange={e=>setAgeFilter(e.target.value)}
>

<option value="all">All Age Groups</option>

{[...new Set(stories.map(s=>s.age))].map(a=>(
<option key={a} value={a}>{a}</option>
))}

</select>

</div>

</div>


{showForm && (

<section className="card">

<div className="card-header">
<h2 className="card-title">
{editingId ? "Edit Story" : "Add New Story"}
</h2>
</div>

<div className="card-body">

<div className="grid-2">

<div className="form-group">
<label className="field-label">Entity</label>
<input className="field-input" value={entity} onChange={e=>setEntity(e.target.value)}/>
</div>

<div className="form-group">
<label className="field-label">Virtues</label>
<input className="field-input" value={virtues} onChange={e=>setVirtues(e.target.value)}/>
</div>

<div className="form-group">
<label className="field-label">Keywords</label>
<input className="field-input" value={keywords} onChange={e=>setKeywords(e.target.value)}/>
</div>

<div className="form-group">
<label className="field-label">Age</label>
<input className="field-input" value={age} onChange={e=>setAge(e.target.value)}/>
</div>

<div className="form-group full">
<label className="field-label">Group</label>
<input className="field-input" value={group} onChange={e=>setGroup(e.target.value)}/>
</div>

</div>

<div className="form-group">

<label className="field-label">Story Text</label>

<textarea
className="field-input textarea"
rows="6"
value={storyText}
onChange={e=>setStoryText(e.target.value)}
/>

</div>

<div className="form-actions">

<button className="primary-btn" onClick={saveStory}>
Save Story
</button>

<button className="secondary-btn" onClick={()=>{
clearForm()
setShowForm(false)
}}>
Cancel
</button>

</div>

</div>

</section>

)}


<section className="card">

<div className="card-header">

<h2 className="card-title">
Annotated Stories ({filteredStories.length})
</h2>

</div>

<div className="card-body">

<table className="stories-table">

<thead>

<tr>
<th>ID</th>
<th>Entity</th>
<th>Age</th>
<th>Group</th>
<th>Actions</th>
</tr>

</thead>

<tbody>

{filteredStories.map(story =>(

<tr key={story.id}>

<td>{story.id}</td>
<td>{story.entity}</td>
<td>{story.age}</td>
<td>{story.group}</td>

<td>

<button
className="btn-ghost"
onClick={()=>editStory(story)}
>
Edit
</button>

<button
className="btn-ghost danger"
onClick={()=>deleteStory(story.id)}
>
Delete
</button>

</td>

</tr>

))}

</tbody>

</table>

</div>

</section>

</div>

)

}